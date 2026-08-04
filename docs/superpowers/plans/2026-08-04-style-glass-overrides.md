# Tabela korekt stylu i szkła — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wiedza eksperta domenowego o stylu i przeszkleniu drzwi trafia do wersjonowanej tabeli korekt, która przebija automat i przeżywa każdy import — a wizja dostarcza do niej hipotez zamiast decyzji.

**Architecture:** Jeden nowy moduł (`overrides.ts`) czyta `docs/style-overrides.json` i odpowiada na pytanie „co wiem o tym modelu". Trzy istniejące ścieżki zapisu flag (backfill stylu, resolver stylu przy imporcie, resolver szkła przy imporcie) pytają go tuż przed zapisem do Chromy. Osobny skrypt `applyOverrides.ts` nakłada tabelę na istniejący katalog bez uruchamiania wizji. Dwa skrypty jednorazowe — przelot wizji i generator galerii — obsługują przegląd, po którym użytkownik dyktuje treść tabeli.

**Tech Stack:** Node.js + Express + TypeScript, ChromaDB (metadane), vitest, OpenRouter (`google/gemini-2.5-flash`) do wizji.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-04-style-glass-overrides-design.md`. Punkt powrotu: `master` @ `2096235`.
- **Semantyka korekty: pełne zastąpienie, nie doklejanie.** Korekta stylu zastępuje wynik głosowania w całości — inaczej nie da się ZDJĄĆ błędnej metki.
- **Model bije kolekcję, ale per pole.** Gdy kolekcja koryguje styl, a model tylko `has_glass`, model dostaje styl z kolekcji i szkło z własnego wpisu.
- `"style": []` znaczy „ten model nie ma stylu" (`style_none`). Brak korekty wyraża się NIEOBECNOŚCIĄ pola, nie pustą tablicą.
- **Walidacja tabeli jest głośna:** styl spoza `STYLES`, zły typ pola albo niepoprawny JSON → wyjątek z nazwą wpisu. Cicha literówka oznaczałaby korektę, która nie działa i nikt tego nie zauważy.
- Warianty koloru dziedziczą korektę swojego modelu (`… model E.4 - Biały` → wpis `PORTA VERTE PREMIUM model E.4`).
- Grupowanie modelu: istniejące `modelOf(name)` z `backend/src/services/glassResolver.ts`. Nie duplikować.
- Komendy uruchamiać z `backend/` (nie z katalogu głównego repo). Skrypty: `npx ts-node --transpile-only src/scripts/<plik>.ts`.
- ChromaDB (:8000), backend (:3001), sidecar (:8001) i front (:5173) DZIAŁAJĄ. Nie restartować, nie zabijać procesów. Backend jedzie na `ts-node-dev --respawn`.
- Skrypty piszące do bazy (`applyOverrides.ts`) wolno uruchamiać wyłącznie w zadaniu, które to nakazuje. `checkStyleConsistency.ts` jest read-only.
- Nazwy domenowe po polsku, jak w istniejącym kodzie; komentarze wyjaśniają „dlaczego", nie „co".
- Stan wyjściowy testów: backend 173/173, front 43/43, `tsc --noEmit` czysty, `npm run build` zielony.

---

### Task 1: Moduł korekt `overrides.ts`

**Files:**
- Create: `docs/style-overrides.json`
- Create: `backend/src/services/overrides.ts`
- Test: `backend/src/services/__tests__/overrides.test.ts`

**Interfaces:**
- Consumes: `STYLES`, typ `Style` z `attributeService`.
- Produces:
  - `export interface Korekta { style?: Style[]; hasGlass?: boolean }`
  - `export function kolekcjaOf(modelName: string): string`
  - `export function czytajTabele(surowy: unknown): TabelaKorekt` (czysta, waliduje)
  - `export function korektaZTabeli(tabela: TabelaKorekt, productName: string): Korekta | null` (czysta)
  - `export function overrideFor(productName: string): Korekta | null` (czyta plik, cache w module)
  - `export function invalidateOverrides(): void`
  - `export interface TabelaKorekt { kolekcje: Record<string, Korekta>; modele: Record<string, Korekta> }`

- [ ] **Step 1: Utwórz pustą tabelę korekt**

Plik `docs/style-overrides.json`:

```json
{
  "_opis": "Korekty stylu i przeszklenia wpisane przez eksperta domenowego. Przebijają automat (głosowanie z opisów, wizję szkła) i są nakładane po backfillu oraz po każdym imporcie. Klucz w 'modele' to nazwa modelu BEZ wariantu koloru (część przed ' - '). Klucz w 'kolekcje' to nazwa modelu bez członu 'model X.Y'. Model bije kolekcję, osobno dla stylu i osobno dla szkła. 'style': [] znaczy 'bez stylu'; brak korekty = brak pola.",
  "kolekcje": {},
  "modele": {}
}
```

- [ ] **Step 2: Write the failing test**

Utwórz `backend/src/services/__tests__/overrides.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { kolekcjaOf, czytajTabele, korektaZTabeli } from '../overrides'

describe('kolekcjaOf — nazwa modelu → nazwa kolekcji', () => {
  it.each([
    ['PORTA VIGO model V.3', 'PORTA VIGO'],
    ['NATURA CLASSIC model 7.1 z bulajem', 'NATURA CLASSIC'],
    ['PORTA VERTE PREMIUM model E.4', 'PORTA VERTE PREMIUM'],
    ['PORTA GLASS szyba grafitowa matowa', 'PORTA GLASS'],
    ['PORTA VECTOR PREMIUM Bulaj Szyba Matowa', 'PORTA VECTOR PREMIUM'],
    ['TRIM, model T0', 'TRIM'],
  ])('%s → %s', (model, oczekiwana) => {
    expect(kolekcjaOf(model)).toBe(oczekiwana)
  })
})

describe('czytajTabele — walidacja jest głośna', () => {
  it('poprawna tabela przechodzi', () => {
    const t = czytajTabele({
      kolekcje: { 'PORTA VIGO': { style: ['rustykalny'] } },
      modele: { 'PORTA VERTE PREMIUM model E.4': { has_glass: true } },
    })
    expect(t.kolekcje['PORTA VIGO'].style).toEqual(['rustykalny'])
    expect(t.modele['PORTA VERTE PREMIUM model E.4'].hasGlass).toBe(true)
  })

  it('pusta tabela jest poprawna', () => {
    expect(czytajTabele({ kolekcje: {}, modele: {} })).toEqual({ kolekcje: {}, modele: {} })
  })

  it('styl spoza listy → wyjątek z nazwą wpisu', () => {
    expect(() =>
      czytajTabele({ kolekcje: { 'PORTA VIGO': { style: ['wiejski'] } }, modele: {} }),
    ).toThrow(/PORTA VIGO/)
  })

  it('style nie będące tablicą → wyjątek', () => {
    expect(() =>
      czytajTabele({ kolekcje: {}, modele: { 'PORTA X model 1': { style: 'rustykalny' } } }),
    ).toThrow(/PORTA X model 1/)
  })

  it('has_glass nie będące boolean → wyjątek', () => {
    expect(() =>
      czytajTabele({ kolekcje: {}, modele: { 'PORTA X model 1': { has_glass: 'tak' } } }),
    ).toThrow(/PORTA X model 1/)
  })

  it('pusta tablica stylów jest DOZWOLONA i znaczy "bez stylu"', () => {
    const t = czytajTabele({ kolekcje: {}, modele: { 'PORTA X model 1': { style: [] } } })
    expect(t.modele['PORTA X model 1'].style).toEqual([])
  })

  it('nie-obiekt → wyjątek', () => {
    expect(() => czytajTabele(null)).toThrow()
    expect(() => czytajTabele([])).toThrow()
  })
})

describe('korektaZTabeli — model bije kolekcję, per pole', () => {
  const tabela = czytajTabele({
    kolekcje: { 'PORTA VIGO': { style: ['rustykalny'], has_glass: false } },
    modele: {
      'PORTA VIGO model V.9': { style: ['nowoczesny'] },
      'PORTA VERTE PREMIUM model E.4': { has_glass: true },
    },
  })

  it('brak wpisu → null', () => {
    expect(korektaZTabeli(tabela, 'PORTA NOVA model 1 - Biały')).toBeNull()
  })

  it('wariant koloru dziedziczy korektę swojego modelu', () => {
    expect(korektaZTabeli(tabela, 'PORTA VERTE PREMIUM model E.4 - Biały')).toEqual({
      hasGlass: true,
    })
  })

  it('kolekcja obejmuje wszystkie swoje modele', () => {
    expect(korektaZTabeli(tabela, 'PORTA VIGO model V.1 - Dąb')).toEqual({
      style: ['rustykalny'],
      hasGlass: false,
    })
  })

  it('model przebija kolekcję TYLKO w polu, które sam definiuje', () => {
    // model V.9 nadpisuje styl, ale szkło zostaje z kolekcji
    expect(korektaZTabeli(tabela, 'PORTA VIGO model V.9 - Biały')).toEqual({
      style: ['nowoczesny'],
      hasGlass: false,
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/overrides.test.ts`
Expected: FAIL — nie można rozwiązać modułu `../overrides`.

- [ ] **Step 4: Write minimal implementation**

Utwórz `backend/src/services/overrides.ts`:

```ts
// Tabela korekt: co ekspert domenowy WIE o drzwiach, a czego automat nie
// potrafi wyczytać. Powstała, bo dwa przypadki okazały się maszynowo nierozstrzygalne:
// przeszklenie modelu E.4 (cztery wąskie pasy szkła satynowego — cztery różne
// rodziny modeli wizyjnych zgodnie widzą tam "listwę metalową") oraz styl kolekcji
// VIGO/CRAFT/VALLO (opisy EN mówią "modern flat panel", a drzwi wyglądają jak zbite
// z desek). Korekta ZASTĘPUJE decyzję automatu — tylko tak da się zdjąć błędną metkę.
import { readFileSync } from 'fs'
import { join } from 'path'
import { STYLES } from './attributeService'
import type { Style } from './attributeService'

const PLIK = join(__dirname, '..', '..', '..', 'docs', 'style-overrides.json')

export interface Korekta {
  style?: Style[]
  hasGlass?: boolean
}

export interface TabelaKorekt {
  kolekcje: Record<string, Korekta>
  modele: Record<string, Korekta>
}

/** Nazwa modelu → nazwa kolekcji. Obcina człon "model X.Y" i dopiski wariantowe. */
export function kolekcjaOf(modelName: string): string {
  return modelName
    .replace(/[\s,]+model\s+.*$/i, '')
    .replace(/\s+(z\s|szyba|Bulaj)\b.*$/i, '')
    .replace(/[\s,]+$/, '')
    .trim()
}

function czytajWpis(klucz: string, surowy: unknown): Korekta {
  if (typeof surowy !== 'object' || surowy === null || Array.isArray(surowy)) {
    throw new Error(`[OVERRIDES] Wpis "${klucz}" musi być obiektem`)
  }
  const w = surowy as Record<string, unknown>
  const korekta: Korekta = {}

  if ('style' in w) {
    if (!Array.isArray(w.style)) {
      throw new Error(`[OVERRIDES] Wpis "${klucz}": pole "style" musi być tablicą`)
    }
    for (const s of w.style) {
      if (!(STYLES as readonly unknown[]).includes(s)) {
        throw new Error(
          `[OVERRIDES] Wpis "${klucz}": nieznany styl ${JSON.stringify(s)}. Dozwolone: ${STYLES.join(', ')}`,
        )
      }
    }
    korekta.style = w.style as Style[]
  }

  if ('has_glass' in w) {
    if (typeof w.has_glass !== 'boolean') {
      throw new Error(`[OVERRIDES] Wpis "${klucz}": pole "has_glass" musi być true albo false`)
    }
    korekta.hasGlass = w.has_glass
  }

  return korekta
}

export function czytajTabele(surowy: unknown): TabelaKorekt {
  if (typeof surowy !== 'object' || surowy === null || Array.isArray(surowy)) {
    throw new Error('[OVERRIDES] Plik korekt musi zawierać obiekt')
  }
  const t = surowy as Record<string, unknown>
  const wynik: TabelaKorekt = { kolekcje: {}, modele: {} }
  for (const sekcja of ['kolekcje', 'modele'] as const) {
    const dane = t[sekcja]
    if (dane === undefined) continue
    if (typeof dane !== 'object' || dane === null || Array.isArray(dane)) {
      throw new Error(`[OVERRIDES] Sekcja "${sekcja}" musi być obiektem`)
    }
    for (const [klucz, wpis] of Object.entries(dane as Record<string, unknown>)) {
      wynik[sekcja][klucz] = czytajWpis(klucz, wpis)
    }
  }
  return wynik
}

/**
 * Korekta dla produktu (nazwa z wariantem koloru albo bez). Scala wpis kolekcji
 * z wpisem modelu OSOBNO DLA KAŻDEGO POLA: kolekcja może dać styl, a model samo
 * szkło. Zwraca null, gdy nic nie pasuje — wtedy decyduje automat.
 */
export function korektaZTabeli(tabela: TabelaKorekt, productName: string): Korekta | null {
  const model = productName.split(' - ')[0].trim()
  const zKolekcji = tabela.kolekcje[kolekcjaOf(model)]
  const zModelu = tabela.modele[model]
  if (!zKolekcji && !zModelu) return null

  const scalona: Korekta = {}
  if (zModelu?.style !== undefined) scalona.style = zModelu.style
  else if (zKolekcji?.style !== undefined) scalona.style = zKolekcji.style
  if (zModelu?.hasGlass !== undefined) scalona.hasGlass = zModelu.hasGlass
  else if (zKolekcji?.hasGlass !== undefined) scalona.hasGlass = zKolekcji.hasGlass
  return scalona
}

let tabela: TabelaKorekt | null = null

export function invalidateOverrides(): void {
  tabela = null
}

export function overrideFor(productName: string): Korekta | null {
  if (!tabela) {
    tabela = czytajTabele(JSON.parse(readFileSync(PLIK, 'utf-8')))
    const n = Object.keys(tabela.kolekcje).length + Object.keys(tabela.modele).length
    console.log(`[OVERRIDES] Wczytano tabelę korekt: ${n} wpisów`)
  }
  return korektaZTabeli(tabela, productName)
}
```

Uwaga: klucz `_opis` w pliku JSON jest ignorowany, bo `czytajTabele` czyta wyłącznie
sekcje `kolekcje` i `modele`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/overrides.test.ts`
Expected: PASS (18 testów).

- [ ] **Step 6: Sprawdź, że pusta tabela z repo wczytuje się bez błędu**

Utwórz `backend/src/scripts/_probeOverrides.ts`:

```ts
import { overrideFor } from '../services/overrides'
console.log('brak wpisu →', overrideFor('PORTA NOVA model 1 - Biały'))
```

Run: `cd backend && npx ts-node --transpile-only src/scripts/_probeOverrides.ts`
Expected: `[OVERRIDES] Wczytano tabelę korekt: 0 wpisów` oraz `brak wpisu → null`.
Potem usuń sondę: `rm backend/src/scripts/_probeOverrides.ts`

- [ ] **Step 7: Commit**

```bash
git add docs/style-overrides.json backend/src/services/overrides.ts backend/src/services/__tests__/overrides.test.ts
git commit -m "feat(overrides): tabela korekt stylu i szkla + walidacja"
```

---

### Task 2: Korekta stylu wpięta w backfill i import

**Files:**
- Modify: `backend/src/services/styleResolver.ts` (dopisać funkcję po `stylesForModel`, użyć jej w `resolveStylesForProducts`)
- Modify: `backend/src/scripts/backfillStyle.ts` (w pętli głosowania)
- Test: `backend/src/services/__tests__/styleResolver.test.ts` (dopisać `describe`)

**Interfaces:**
- Consumes: `overrideFor` z Taska 1; `stylesForModel(descriptions: string[]): Style[]` (istnieje).
- Produces: `export function stylesForModelName(modelName: string, descriptions: string[]): Style[]` — używa go Task 4 (`applyOverrides.ts`).

- [ ] **Step 1: Write the failing test**

Dopisz na końcu `backend/src/services/__tests__/styleResolver.test.ts`:

```ts
describe('stylesForModelName — korekta przebija głosowanie', () => {
  it('bez wpisu w tabeli zachowuje się jak stylesForModel', () => {
    const opisy = [
      'modern residential interior door light oak',
      'modern residential interior door white',
      'classic raised panel residential door',
    ]
    expect(stylesForModelName('PORTA NOVA model 1', opisy)).toEqual(stylesForModel(opisy))
  })

  it('opisy mówiące "modern" nie przebijają korekty (pusta tabela → brak zmiany)', () => {
    // Tabela w repo jest pusta na tym etapie, więc korekta nie działa dla żadnego
    // modelu — ten test pilnuje, że brak wpisu NIE wywraca funkcji.
    expect(stylesForModelName('PORTA VIGO model V.3', ['modern flat panel door'])).toEqual([
      'nowoczesny',
    ])
  })
})
```

Uzupełnij import na górze pliku testowego: dopisz `stylesForModelName` do listy importów z `'../styleResolver'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/styleResolver.test.ts`
Expected: FAIL — `stylesForModelName is not a function`.

- [ ] **Step 3: Write minimal implementation**

W `backend/src/services/styleResolver.ts` dopisz import na górze:

```ts
import { overrideFor } from './overrides'
```

i nową funkcję zaraz po `stylesForModel`:

```ts
/**
 * Styl modelu z uwzględnieniem tabeli korekt. Korekta ZASTĘPUJE głosowanie —
 * ekspert domenowy widzi drzwi, których opis EN nie oddaje (VIGO/CRAFT/VALLO
 * to wizualnie deski, a opis mówi "modern flat panel").
 */
export function stylesForModelName(modelName: string, descriptions: string[]): Style[] {
  const korekta = overrideFor(modelName)
  if (korekta?.style !== undefined) return korekta.style
  return stylesForModel(descriptions)
}
```

Następnie w `resolveStylesForProducts` zamień wywołanie głosowania. Znajdź linię:

```ts
    const flags = styleFlags(stylesForModel(warianty.map((w) => String(w.meta.description ?? ''))))
```

i zastąp ją:

```ts
    const flags = styleFlags(
      stylesForModelName(model, warianty.map((w) => String(w.meta.description ?? ''))),
    )
```

W tej pętli zmienna klucza nazywa się `model` — jeśli pętla ma postać `for (const [, warianty] of byModel)`, zmień ją na `for (const [model, warianty] of byModel)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/styleResolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Wepnij korektę w backfill stylu**

W `backend/src/scripts/backfillStyle.ts` zamień import:

```ts
import { aggregateStyles, classifyStyles, styleFlags } from '../services/attributeService'
```

na:

```ts
import { classifyStyles, styleFlags } from '../services/attributeService'
import { stylesForModelName } from '../services/styleResolver'
```

W pętli głosowania zastąp fragment:

```ts
  for (const [, warianty] of byModel) {
    // Puste opisy (import z UI, obrazkowy) pomijamy PRZED głosowaniem — patrz
    // ten sam guard i uzasadnienie w styleResolver.stylesForModel (F3).
    const opisy = warianty.map((w) => String(w.meta.description ?? '')).filter((d) => d.trim())
    const style = aggregateStyles(opisy.map((d) => classifyStyles(d)))
```

fragmentem:

```ts
  for (const [model, warianty] of byModel) {
    // Głosowanie z opisów + tabela korekt (korekta zastępuje wynik głosowania).
    // Filtrowanie pustych opisów siedzi w stylesForModel — patrz uzasadnienie tam.
    const opisy = warianty.map((w) => String(w.meta.description ?? ''))
    const style = stylesForModelName(model, opisy)
```

Zauważ: `classifyStyles` przestaje być wołane wprost w tym pliku, ale zostaje w imporcie
tylko wtedy, gdy nadal go używasz — jeśli nie, usuń go z importu, żeby `tsc` nie zgłaszał
nieużywanej zmiennej.

- [ ] **Step 6: Weryfikacja typów i pełnego zestawu**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` bez wyjścia; wszystkie testy zielone (173 + nowe z Tasków 1–2).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/styleResolver.ts backend/src/scripts/backfillStyle.ts backend/src/services/__tests__/styleResolver.test.ts
git commit -m "feat(overrides): korekta stylu przebija glosowanie w backfillu i imporcie"
```

---

### Task 3: Korekta szkła wpięta w resolver i backfill

**Files:**
- Modify: `backend/src/services/glassResolver.ts` (nowa funkcja + użycie w `resolveGlassForProducts`)
- Modify: `backend/src/scripts/backfillGlass.ts` (w miejscu stosowania decyzji)
- Test: `backend/src/services/__tests__/glassResolver.test.ts` (dopisać `describe`)

**Interfaces:**
- Consumes: `overrideFor` z Taska 1.
- Produces: `export function glassForModelName(modelName: string, decyzja: boolean | null): boolean | null` — używa go Task 4 (`applyOverrides.ts`).

- [ ] **Step 1: Write the failing test**

Dopisz na końcu `backend/src/services/__tests__/glassResolver.test.ts`:

```ts
describe('glassForModelName — korekta przebija decyzję automatu', () => {
  it('bez wpisu w tabeli zwraca decyzję automatu', () => {
    expect(glassForModelName('PORTA NOVA model 1', true)).toBe(true)
    expect(glassForModelName('PORTA NOVA model 1', false)).toBe(false)
  })

  it('bez wpisu i bez decyzji zwraca null (model cichy)', () => {
    expect(glassForModelName('PORTA NOVA model 1', null)).toBeNull()
  })
})
```

Uzupełnij import na górze pliku testowego: dopisz `glassForModelName` do importu z `'../glassResolver'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/glassResolver.test.ts`
Expected: FAIL — `glassForModelName is not a function`.

- [ ] **Step 3: Write minimal implementation**

W `backend/src/services/glassResolver.ts` dopisz import:

```ts
import { overrideFor } from './overrides'
```

i funkcję zaraz po `decideGlassFromName`:

```ts
/**
 * Szkło modelu z uwzględnieniem tabeli korekt. Korekta ZASTĘPUJE decyzję automatu,
 * bo dla części modeli packshot jej nie niesie: przy VERTE PREMIUM E.4 (cztery
 * wąskie pasy szkła satynowego) cztery różne rodziny modeli wizyjnych zgodnie
 * orzekają "listwa metalowa". Tu wygrywa wiedza eksperta domenowego.
 */
export function glassForModelName(modelName: string, decyzja: boolean | null): boolean | null {
  const korekta = overrideFor(modelName)
  if (korekta?.hasGlass !== undefined) return korekta.hasGlass
  return decyzja
}
```

Następnie w `resolveGlassForProducts`, w pętli stosującej decyzje, zamień:

```ts
  for (const [model, variants] of byModel) {
    if (!decisions.has(model)) continue
    const glass = decisions.get(model)!
```

na:

```ts
  for (const [model, variants] of byModel) {
    // Korekta obowiązuje nawet dla modeli, których automat nie rozstrzygnął
    // (brak wpisu w decisions) — dlatego pytamy ją PRZED sprawdzeniem decisions.
    const glass = glassForModelName(model, decisions.has(model) ? decisions.get(model)! : null)
    if (glass === null) continue
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/glassResolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Wepnij korektę w backfill szkła**

W `backend/src/scripts/backfillGlass.ts` dopisz import:

```ts
import { glassForModelName } from '../services/glassResolver'
```

W miejscu, gdzie skrypt stosuje decyzje z pliku postępu do rekordów (pętla z
`const dec = progress[model]`), zastąp odczyt decyzji:

```ts
    const dec = progress[model]
```

wersją z korektą:

```ts
    const zProgressu = progress[model]
    const dec = { glass: glassForModelName(model, zProgressu?.glass ?? null) }
```

Reszta pętli (pominięcie, gdy `dec.glass` jest `null`, i porównanie z `has_glass`)
zostaje bez zmian.

- [ ] **Step 6: Weryfikacja typów i pełnego zestawu**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` bez wyjścia; wszystkie testy zielone.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/glassResolver.ts backend/src/scripts/backfillGlass.ts backend/src/services/__tests__/glassResolver.test.ts
git commit -m "feat(overrides): korekta szkla przebija decyzje automatu"
```

---

### Task 4: Skrypt nakładający korekty na istniejący katalog

**Files:**
- Create: `backend/src/scripts/applyOverrides.ts`
- Test: brak testu jednostkowego (skrypt operacyjny); weryfikacja przez uruchomienie na pustej tabeli

**Interfaces:**
- Consumes: `stylesForModelName` (Task 2), `glassForModelName` (Task 3), `overrideFor` (Task 1), `modelOf` z `glassResolver`, `categorizeDoor` z `chromaService`, `styleFlags` z `attributeService`.
- Produces: skrypt operacyjny — używany w Tasku 7.

**Dlaczego ten skrypt istnieje (odstępstwo od specu):** spec mówił „backfill nałożył
korekty", ale korekta SZKŁA przez `backfillGlass.ts` znaczyłaby ponowny przelot wizji po
całym katalogu — kosztowny i zbędny. Ten skrypt nakłada obie korekty naraz, czyta tylko
metadane, jest idempotentny i nie woła żadnego modelu.

- [ ] **Step 1: Napisz skrypt**

Utwórz `backend/src/scripts/applyOverrides.ts`:

```ts
// Nakłada docs/style-overrides.json na ISTNIEJĄCY katalog: styl i has_glass.
// Metadane-only, bez wizji, bez Gemini, bez embeddingów. Idempotentny —
// drugie uruchomienie nie zmienia niczego.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/applyOverrides.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { styleFlags } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'
import { modelOf, glassForModelName } from '../services/glassResolver'
import { stylesForModelName } from '../services/styleResolver'
import { overrideFor } from '../services/overrides'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  const byModel = new Map<string, Array<{ id: string; meta: Record<string, unknown> }>>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const meta = (r.metadatas[i] ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push({ id, meta })
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[OVERRIDES] Residential w ${byModel.size} modelach`)

  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  let modeliZeStylem = 0
  let modeliZeSzklem = 0

  for (const [model, warianty] of byModel) {
    const korekta = overrideFor(model)
    if (!korekta) continue

    const zmiany: Record<string, unknown> = {}
    if (korekta.style !== undefined) {
      // stylesForModelName zwróci korektę; opisy podajemy dla porządku
      Object.assign(
        zmiany,
        styleFlags(stylesForModelName(model, warianty.map((w) => String(w.meta.description ?? '')))),
      )
      modeliZeStylem++
    }
    if (korekta.hasGlass !== undefined) {
      zmiany.has_glass = glassForModelName(model, null)
      modeliZeSzklem++
    }

    for (const w of warianty) {
      const różni = Object.entries(zmiany).some(([k, v]) => w.meta[k] !== v)
      if (!różni) continue
      ids.push(w.id)
      metas.push({ ...w.meta, ...zmiany })
    }
  }

  console.log(
    `[OVERRIDES] Korekty dotyczą ${modeliZeStylem} modeli (styl) i ${modeliZeSzklem} (szkło); rekordów do zmiany: ${ids.length}`,
  )
  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
    console.log(`[OVERRIDES] zaktualizowano ${Math.min(i + 200, ids.length)}/${ids.length}`)
  }
  console.log('[OVERRIDES] GOTOWE.')
  console.log(
    '[OVERRIDES] UWAGA: zrestartuj backend (albo dotknij pliku w backend/src — ts-node-dev ' +
      'przeładuje się sam), inaczej liczniki chipów stylu pozostaną sprzed korekt.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Uruchom na pustej tabeli — musi być bezpieczny**

Run: `cd backend && npx ts-node --transpile-only src/scripts/applyOverrides.ts`
Expected: `Wczytano tabelę korekt: 0 wpisów`, `Residential w 580 modelach`,
`Korekty dotyczą 0 modeli (styl) i 0 (szkło); rekordów do zmiany: 0`, `GOTOWE`.
Zero zapisów do bazy przy pustej tabeli — to jest dowód, że skrypt nie rusza niczego
na własną rękę.

- [ ] **Step 3: Potwierdź, że katalog jest nietknięty**

Run: `cd backend && npx ts-node --transpile-only src/scripts/checkStyleConsistency.ts`
Expected: `niespójnych: 0`, rozkład stylów jak przed uruchomieniem
(rustykalny 97, loft 243, klasyczny 786, nowoczesny 7582, minimalistyczny 489,
skandynawski 3, glamour 15, bez stylu 26).

- [ ] **Step 4: Commit**

```bash
git add backend/src/scripts/applyOverrides.ts
git commit -m "feat(overrides): skrypt nakladajacy tabele na istniejacy katalog"
```

---

### Task 5: Przelot wizji — generator propozycji

**Files:**
- Create: `backend/src/scripts/visionStylePass.ts`
- Modify: `.gitignore` (dopisać plik propozycji)
- Test: brak testu jednostkowego (skrypt operacyjny, wołający model); weryfikacja przez uruchomienie

**Interfaces:**
- Consumes: `STYLES` z `attributeService`, `modelOf` z `glassResolver`, `categorizeDoor` z `chromaService`.
- Produces: plik `scripts/vision_style_proposals.json` o kształcie
  `Record<nazwaModelu, { style: string[] }>` — czyta go Task 6.

- [ ] **Step 1: Dopisz plik propozycji do .gitignore**

W `.gitignore`, obok istniejącego wpisu `scripts/logs/`, dopisz:

```
scripts/vision_style_proposals.json
scripts/style-review.html
```

- [ ] **Step 2: Napisz skrypt**

Utwórz `backend/src/scripts/visionStylePass.ts`:

```ts
// Przelot wizji po MODELACH: jedno pytanie o styl na model, wynik do pliku
// propozycji. NIE ZAPISUJE NICZEGO DO CHROMY — wizja tu wyłącznie proponuje,
// bo na próbkach rozjeżdżała się z opisem w obie strony (rustykalny 21% katalogu
// wobec 3,6% dziś, ale też trafnie zdejmowała "klasyczny" z płaskiego skrzydła
// z bulajem). Arbitrem jest ekspert domenowy, patrz galeria przeglądu.
// Wznawialny: ponowne uruchomienie pomija modele już rozstrzygnięte.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/visionStylePass.ts
import 'dotenv/config'
import axios from 'axios'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ChromaClient } from 'chromadb'
import { STYLES } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'
import { modelOf } from '../services/glassResolver'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const PLIK = join(__dirname, '..', '..', '..', 'scripts', 'vision_style_proposals.json')
const MODEL_WIZJI = 'google/gemini-2.5-flash'
const WSPOLBIEZNOSC = 4

const PROMPT = `You are a Polish interior-door merchandiser tagging a product photo of ONE door leaf.

Choose EVERY style that genuinely applies, from exactly this list:
klasyczny (raised/moulded panels, mouldings, traditional proportions)
nowoczesny (clean flat leaf, simple lines)
minimalistyczny (no ornament at all, single flat plane)
rustykalny (plank/board look, framed boards, prominent decorative wood grain, knots, barn/farmhouse feel)
loft (black frames, grid glazing, raw industrial look)
skandynawski (pale wood AND deliberately light, airy, simple — not merely "light coloured")
glamour (ornate, luxurious, decorative inlays, gloss, gold/silver accents)

Be strict: assign a style ONLY if the photo actually shows it. Most doors have 1-2 styles.

Output ONLY JSON: {"style": ["..."]}`

interface Propozycja {
  style: string[]
}

function wczytaj(): Record<string, Propozycja> {
  return existsSync(PLIK) ? JSON.parse(readFileSync(PLIK, 'utf-8')) : {}
}

function zapisz(dane: Record<string, Propozycja>): void {
  writeFileSync(PLIK, JSON.stringify(dane, null, 2), 'utf-8')
}

async function zapytajWizje(imageUrl: string): Promise<string[] | null> {
  const res = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: MODEL_WIZJI,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1500,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    },
  )
  const raw = String(res.data.choices[0].message.content).replace(/```(?:json)?/g, '').trim()
  const parsed = JSON.parse(raw) as { style?: unknown }
  if (!Array.isArray(parsed.style)) return null
  // Odsiewamy wszystko spoza taksonomii — model bywa twórczy.
  return parsed.style.filter((s): s is string => (STYLES as readonly unknown[]).includes(s))
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Brak OPENROUTER_API_KEY w backend/.env')
  }
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // Reprezentant modelu = pierwszy wariant ze zdjęciem.
  const reprezentanci = new Map<string, string>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    for (const m of r.metadatas) {
      const meta = (m ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      const img = String(meta.imageUrl ?? '')
      if (!img || categorizeDoor(name) !== 'residential') continue
      const model = modelOf(name)
      if (!reprezentanci.has(model)) reprezentanci.set(model, img)
    }
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  const propozycje = wczytaj()
  const kolejka = [...reprezentanci.entries()].filter(([model]) => !propozycje[model])
  console.log(
    `[WIZJA] Modeli: ${reprezentanci.size}, już rozstrzygniętych: ${Object.keys(propozycje).length}, do zrobienia: ${kolejka.length}`,
  )

  let zrobione = 0
  let bledy = 0
  async function worker() {
    while (kolejka.length > 0) {
      const [model, img] = kolejka.shift()!
      try {
        const style = await zapytajWizje(img)
        if (style) propozycje[model] = { style }
        else bledy++
      } catch (err) {
        bledy++
        console.warn(`[WIZJA] ${model}: ${err instanceof Error ? err.message : err}`)
      }
      zrobione++
      if (zrobione % 20 === 0) {
        zapisz(propozycje)
        console.log(`[WIZJA] ${zrobione}/${zrobione + kolejka.length} (błędów: ${bledy})`)
      }
    }
  }
  await Promise.all(Array.from({ length: WSPOLBIEZNOSC }, worker))
  zapisz(propozycje)

  const licznik: Record<string, number> = {}
  for (const p of Object.values(propozycje)) {
    for (const s of p.style) licznik[s] = (licznik[s] ?? 0) + 1
  }
  console.log(`[WIZJA] GOTOWE. Rozstrzygniętych modeli: ${Object.keys(propozycje).length}, błędów: ${bledy}`)
  console.log('[WIZJA] Rozkład propozycji (modeli per styl):', JSON.stringify(licznik))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 3: Uruchom przelot**

Run: `cd backend && npx ts-node --transpile-only src/scripts/visionStylePass.ts`
Expected: ~580 modeli, kilka minut, na końcu rozkład propozycji. Spodziewane rzędy
wielkości na podstawie kalibracji z 14 modeli: rustykalny ~20% modeli, skandynawski ~30%,
nowoczesny większość. Błędy pojedyncze (timeouty) są dopuszczalne — skrypt jest wznawialny,
uruchom go ponownie, a dokończy tylko brakujące.

- [ ] **Step 4: Commit**

```bash
git add backend/src/scripts/visionStylePass.ts .gitignore
git commit -m "feat(overrides): przelot wizji generujacy propozycje stylu"
```

---

### Task 6: Galeria przeglądu

**Files:**
- Create: `backend/src/scripts/buildStyleReview.ts`
- Test: `backend/src/scripts/__tests__/rozjazd.test.ts`

**Interfaces:**
- Consumes: plik propozycji z Taska 5, flagi z Chromy, `kolekcjaOf` z `overrides` (Task 1).
- Produces: `scripts/style-review.html`; eksportuje czystą funkcję
  `export function rozjazd(zOpisu: string[], zWizji: string[]): number` (do testu).

- [ ] **Step 1: Write the failing test**

Utwórz `backend/src/scripts/__tests__/rozjazd.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rozjazd } from '../buildStyleReview'

describe('rozjazd — miara niezgody opisu z wizją', () => {
  it('identyczne zestawy → 0', () => {
    expect(rozjazd(['nowoczesny'], ['nowoczesny'])).toBe(0)
    expect(rozjazd(['nowoczesny', 'loft'], ['loft', 'nowoczesny'])).toBe(0)
  })

  it('styl tylko w wizji liczy się jako rozjazd', () => {
    expect(rozjazd(['nowoczesny'], ['nowoczesny', 'rustykalny'])).toBe(1)
  })

  it('styl tylko w opisie też liczy się jako rozjazd', () => {
    expect(rozjazd(['nowoczesny', 'rustykalny'], ['nowoczesny'])).toBe(1)
  })

  it('rozłączne zestawy → suma obu stron', () => {
    expect(rozjazd(['klasyczny'], ['rustykalny', 'skandynawski'])).toBe(3)
  })

  it('puste zestawy → 0', () => {
    expect(rozjazd([], [])).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/scripts/__tests__/rozjazd.test.ts`
Expected: FAIL — nie można rozwiązać modułu `../buildStyleReview`.

- [ ] **Step 3: Write minimal implementation**

Utwórz `backend/src/scripts/buildStyleReview.ts`:

```ts
// Buduje statyczną galerię do przeglądu: kafelek na kolekcję z packshotem,
// metkami z opisu i propozycją wizji, posortowany od największego rozjazdu.
// Strona jest lokalna, więc obrazy ładują się wprost z porta.com.pl.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/buildStyleReview.ts
import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ChromaClient } from 'chromadb'
import { STYLES } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'
import { modelOf } from '../services/glassResolver'
import { kolekcjaOf } from '../services/overrides'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const PROPOZYCJE = join(__dirname, '..', '..', '..', 'scripts', 'vision_style_proposals.json')
const WYJSCIE = join(__dirname, '..', '..', '..', 'scripts', 'style-review.html')

/** Liczba stylów, co do których opis i wizja się nie zgadzają (symetryczna różnica). */
export function rozjazd(zOpisu: string[], zWizji: string[]): number {
  const a = new Set(zOpisu)
  const b = new Set(zWizji)
  let n = 0
  for (const s of a) if (!b.has(s)) n++
  for (const s of b) if (!a.has(s)) n++
  return n
}

interface Model {
  model: string
  imageUrl: string
  warianty: number
  zOpisu: string[]
  zWizji: string[]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function metki(style: string[], klasa: string): string {
  if (style.length === 0) return '<span class="pusto">bez stylu</span>'
  return style.map((s) => `<span class="metka ${klasa}">${esc(s)}</span>`).join(' ')
}

async function main() {
  if (!existsSync(PROPOZYCJE)) {
    throw new Error(`Brak pliku propozycji: ${PROPOZYCJE}. Uruchom najpierw visionStylePass.ts`)
  }
  const propozycje = JSON.parse(readFileSync(PROPOZYCJE, 'utf-8')) as Record<string, { style: string[] }>

  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })
  const modele = new Map<string, Model>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    for (const m of r.metadatas) {
      const meta = (m ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') continue
      const model = modelOf(name)
      const istniejacy = modele.get(model)
      if (istniejacy) {
        istniejacy.warianty++
        continue
      }
      modele.set(model, {
        model,
        imageUrl: String(meta.imageUrl ?? ''),
        warianty: 1,
        zOpisu: STYLES.filter((s) => meta['style_' + s] === true),
        zWizji: propozycje[model]?.style ?? [],
      })
    }
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  // Grupowanie po kolekcji
  const kolekcje = new Map<string, Model[]>()
  for (const m of modele.values()) {
    const k = kolekcjaOf(m.model)
    if (!kolekcje.has(k)) kolekcje.set(k, [])
    kolekcje.get(k)!.push(m)
  }

  // Waga rozjazdu: suma po modelach, ważona liczbą wariantów — najpierw to,
  // co realnie widać w wynikach wyszukiwania.
  const posortowane = [...kolekcje.entries()]
    .map(([nazwa, lista]) => ({
      nazwa,
      lista,
      waga: lista.reduce((s, m) => s + rozjazd(m.zOpisu, m.zWizji) * m.warianty, 0),
      niejednorodna:
        new Set(lista.map((m) => [...m.zWizji].sort().join(','))).size > 1,
    }))
    .sort((a, b) => b.waga - a.waga)

  const kafelki = posortowane
    .map(({ nazwa, lista, waga, niejednorodna }) => {
      const rep = lista.find((m) => m.imageUrl) ?? lista[0]
      const warianty = lista.reduce((s, m) => s + m.warianty, 0)
      const odszczepiency = niejednorodna
        ? `<details><summary>modele w tej kolekcji różnią się (${lista.length}) — rozwiń</summary>
             <div class="modele">` +
          lista
            .map(
              (m) => `<div class="model">
                 <img src="${esc(m.imageUrl)}" loading="lazy" alt="">
                 <div><b>${esc(m.model)}</b> · ${m.warianty} war.<br>
                 opis: ${metki(m.zOpisu, 'opis')}<br>
                 wizja: ${metki(m.zWizji, 'wizja')}</div>
               </div>`,
            )
            .join('') +
          `</div></details>`
        : ''
      return `<article class="kafelek">
        <img class="rep" src="${esc(rep.imageUrl)}" loading="lazy" alt="">
        <div class="tresc">
          <h2>${esc(nazwa)}</h2>
          <p class="meta">${lista.length} modeli · ${warianty} wariantów · rozjazd ${waga}</p>
          <p>opis: ${metki(rep.zOpisu, 'opis')}</p>
          <p>wizja: ${metki(rep.zWizji, 'wizja')}</p>
          ${odszczepiency}
        </div>
      </article>`
    })
    .join('\n')

  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<title>Przegląd stylu — ${kolekcje.size} kolekcji</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; background: #faf9f7; color: #1c1a17; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .info { color: #6b655d; margin: 0 0 24px; }
  .kafelek { display: flex; gap: 16px; background: #fff; border: 1px solid #e7e2da; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .rep { width: 90px; height: 200px; object-fit: contain; background: #f4f2ee; border-radius: 8px; flex-shrink: 0; }
  .tresc { flex: 1; min-width: 0; }
  h2 { font-size: 17px; margin: 0 0 2px; }
  .meta { color: #6b655d; font-size: 13px; margin: 0 0 10px; }
  p { margin: 4px 0; }
  .metka { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 13px; }
  .opis { background: #eceae4; }
  .wizja { background: #e5efe6; }
  .pusto { color: #9a938a; font-style: italic; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: #6b655d; font-size: 13px; }
  .modele { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
  .model { display: flex; gap: 8px; align-items: flex-start; width: 340px; font-size: 13px; }
  .model img { width: 46px; height: 100px; object-fit: contain; background: #f4f2ee; border-radius: 6px; }
</style></head>
<body>
<h1>Przegląd stylu — ${kolekcje.size} kolekcji, ${modele.size} modeli</h1>
<p class="info">Posortowane od największego rozjazdu opisu z wizją. „opis" to stan dzisiejszy w bazie, „wizja" to propozycja z packshotu — żadne z nich nie jest jeszcze zapisane jako decyzja.</p>
${kafelki}
</body></html>`

  writeFileSync(WYJSCIE, html, 'utf-8')
  console.log(`[REVIEW] Zapisano ${WYJSCIE}`)
  console.log(`[REVIEW] Kolekcji: ${kolekcje.size}, modeli: ${modele.size}`)
  console.log('[REVIEW] Kolekcje z największym rozjazdem:')
  for (const k of posortowane.slice(0, 12)) {
    console.log(`  ${String(k.waga).padStart(4)}  ${k.nazwa} (${k.lista.length} modeli)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/scripts/__tests__/rozjazd.test.ts`
Expected: PASS (5 testów).

- [ ] **Step 5: Wygeneruj galerię**

Run: `cd backend && npx ts-node --transpile-only src/scripts/buildStyleReview.ts`
Expected: `Zapisano …/scripts/style-review.html`, lista 12 kolekcji z największym
rozjazdem. Sprawdź, że plik istnieje i ma powyżej 50 kB.

- [ ] **Step 6: Weryfikacja pełnego zestawu**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` bez wyjścia; wszystkie testy zielone.

- [ ] **Step 7: Commit**

```bash
git add backend/src/scripts/buildStyleReview.ts backend/src/scripts/__tests__/rozjazd.test.ts
git commit -m "feat(overrides): galeria przegladu stylu z packshotami"
```

---

### Task 7: Decyzje użytkownika, nałożenie i weryfikacja

**Files:**
- Modify: `docs/style-overrides.json` (wypełnienie decyzjami użytkownika)
- Test: e2e przez API + `checkStyleConsistency.ts`

**Interfaces:**
- Consumes: wszystko z Tasków 1–6.
- Produces: skorygowany katalog w ChromaDB.

**To zadanie wymaga udziału użytkownika.** Nie da się go wykonać bez jego decyzji —
galeria pokazuje propozycje, ale wpisy do tabeli dyktuje ekspert domenowy.

- [ ] **Step 1: Przedstaw galerię użytkownikowi**

Otwórz `scripts/style-review.html` w przeglądarce i przekaż użytkownikowi:
- ścieżkę do pliku,
- listę 12 kolekcji z największym rozjazdem (z wyjścia skryptu),
- przypomnienie, że wskazał wcześniej jako rustykalne: OSLO, VECTOR, VIGO,
  VERTE HOME model M, CRAFT, VALLO,
- oraz że `PORTA VERTE PREMIUM model E.4` ma mieć `has_glass: true`.

Poproś o decyzje w formie „kolekcja → style" i „model → style/szkło".

- [ ] **Step 2: Wpisz decyzje do tabeli**

Uzupełnij `docs/style-overrides.json` sekcje `kolekcje` i `modele` zgodnie z tym, co podał
użytkownik. Przykład kształtu (wartości zastąp jego decyzjami):

```json
{
  "_opis": "…bez zmian…",
  "kolekcje": {
    "PORTA VIGO": { "style": ["rustykalny", "nowoczesny"] },
    "PORTA CRAFT": { "style": ["rustykalny"] }
  },
  "modele": {
    "PORTA VERTE PREMIUM model E.4": { "has_glass": true }
  }
}
```

- [ ] **Step 3: Sprawdź, że tabela przechodzi walidację**

Run: `cd backend && npx vitest run src/services/__tests__/overrides.test.ts`
Expected: PASS (testy jednostkowe nie czytają pliku z repo).

Run: `cd backend && npx ts-node --transpile-only src/scripts/applyOverrides.ts`
Expected: `Wczytano tabelę korekt: N wpisów` — jeśli w pliku jest literówka w nazwie stylu,
skrypt padnie z komunikatem wskazującym winny wpis. Napraw i uruchom ponownie.

- [ ] **Step 4: Potwierdź spójność po nałożeniu**

Run: `cd backend && npx ts-node --transpile-only src/scripts/checkStyleConsistency.ts`
Expected: `niespójnych: 0`; liczba wariantów rustykalnych wzrosła o warianty kolekcji
wskazanych przez użytkownika.

- [ ] **Step 5: Potwierdź idempotencję**

Run: `cd backend && npx ts-node --transpile-only src/scripts/applyOverrides.ts`
Expected: `rekordów do zmiany: 0` przy drugim uruchomieniu — korekta nałożona raz nie
przepisuje bazy w kółko.

- [ ] **Step 6: Zrestartuj indeks liczników**

Backend cache'uje indeks przekrojów w pamięci procesu. Dotknij dowolnego pliku, żeby
`ts-node-dev` przeładował serwer:

Run: `cd backend && npx tsc --noEmit`
Następnie edytuj i zapisz bez zmian dowolny plik w `backend/src` (albo poczekaj na
przeładowanie po commicie). Potwierdź: `curl -s http://localhost:3001/api/health; echo ""`
Expected: `{"status":"ok",...}`.

- [ ] **Step 7: E2e — styl**

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"drzwi rustykalne\",\"style\":\"rustykalny\"}" | python -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line)
    if e.get('type') == 'result':
        d = e['data']
        print('rustykalny:', d.get('styleCounts',{}).get('rustykalny'))
        for p in d['products']: print(' -', p['name'])
"
```
Expected: w wynikach pojawiają się modele z kolekcji wskazanych przez użytkownika
(VIGO / CRAFT / VALLO), licznik `rustykalny` wzrósł względem 97.

- [ ] **Step 8: E2e — szkło**

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"drzwi bez przeszklenia\"}" | python -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line)
    if e.get('type') == 'result':
        for p in e['data']['products']: print(' -', p['name'])
"
```
Expected: brak `PORTA VERTE PREMIUM model E.4` na liście.

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"drzwi ze szklem\"}" | python -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line)
    if e.get('type') == 'result':
        for p in e['data']['products']: print(' -', p['name'])
"
```
Expected: E.4 może się pojawić (nie musi — ranking decyduje), ale nie może już być
klasyfikowany jako pełne.

- [ ] **Step 9: Pełna regresja**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: wszystkie testy zielone, `tsc` bez wyjścia.

Run: `cd frontend && npx vitest run && npm run build`
Expected: 43/43 zielone, build zielony.

- [ ] **Step 10: Commit**

```bash
git add docs/style-overrides.json
git commit -m "feat(overrides): korekty stylu i szkla wpisane przez wlasciciela katalogu"
```

---

## Self-Review

**Pokrycie specyfikacji:**

| Wymaganie specyfikacji | Task |
|---|---|
| Tabela `docs/style-overrides.json` w repo | 1 |
| `overrideFor`, walidacja głośna, cache w module | 1 |
| Model bije kolekcję per pole; wariant dziedziczy model | 1 |
| `"style": []` = bez stylu | 1 (test) |
| Korekta stylu w `backfillStyle` i `styleResolver` | 2 |
| Korekta szkła w `glassResolver` i `backfillGlass` | 3 |
| Nałożenie korekt na istniejący katalog | 4 |
| Przelot wizji, wznawialny, bez zapisu do Chromy | 5 |
| Galeria posortowana od największego rozjazdu, odszczepieńcy | 6 |
| Decyzje użytkownika → tabela → weryfikacja e2e | 7 |
| Idempotencja nałożenia | 7 (krok 5) |
| `checkStyleConsistency` = 0 niespójnych | 7 (krok 4) |

**Odstępstwo od specyfikacji:** spec mówił, że korekty nakłada backfill. Plan dokłada
osobny skrypt `applyOverrides.ts` (Task 4), bo nałożenie korekty SZKŁA przez
`backfillGlass.ts` oznaczałoby ponowny przelot wizji po całym katalogu — kosztowny
i zbędny. `applyOverrides.ts` czyta wyłącznie metadane i jest idempotentny.

**Spójność nazw:** `kolekcjaOf`/`czytajTabele`/`korektaZTabeli`/`overrideFor` (Task 1)
używane w Taskach 2, 3, 4, 6; `stylesForModelName` (Task 2) w Tasku 4; `glassForModelName`
(Task 3) w Tasku 4; `rozjazd` (Task 6) tylko lokalnie. Pole w JSON to `has_glass`
(snake_case, jak w metadanych Chromy), a w TypeScript `hasGlass` — konwersja siedzi
w `czytajWpis` i jest pokryta testem.
