# Styl jako cecha modelu + wygaszanie chipów — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Styl przestaje być cechą wariantu i staje się cechą modelu (jedna decyzja propagowana na wszystkie kolory), a chipy stylu bez trafień są przygaszone z liczbą trafień zamiast degenerować wyniki do drzwi bezstylowych.

**Architecture:** Głos pojedynczego wariantu (`classifyStyles` na opisie EN) zostaje bez zmian; nowa czysta funkcja `aggregateStyles` zlicza głosy wariantów modelu regułą „większość, inaczej lider". Backfill nadaje spójne flagi całemu katalogowi, `styleResolver` utrzymuje spójność przy imporcie (bliźniak `glassResolver`, bez wizji), a `styleIndex` (indeks metadanych w pamięci, wzorzec `nameIndex` z `chromaService`) liczy przekroje dla liczników chipów i dla decyzji o pominięciu filtra.

**Tech Stack:** Node.js + Express + TypeScript, ChromaDB (metadane boolean), vitest (backend i front), React 18 + Tailwind v3.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-style-per-model-design.md`. Punkt powrotu: `master` @ `5b6a4cd`.
- Reguła agregacji: **większość (>50% wariantów), a przy braku większości — styl(e) z największą liczbą głosów**. Brak jakichkolwiek głosów → `[]` → `style_none`.
- Grupowanie modelu: istniejące `modelOf(name)` z `backend/src/services/glassResolver.ts` (`name.split(' - ')[0].trim()`). Nie tworzyć drugiej implementacji.
- Liczniki chipów są **ścisłe**: liczą rekordy z flagą `style_<styl> === true`. Drzwi bezstylowe liczą się jako 0 dla każdego stylu.
- Żadnych cichych podmian kryteriów: każdy pominięty filtr ma zdanie w polu `notice`.
- Zero wizji i zero Gemini w ścieżce stylu — źródłem jest opis EN z metadanych.
- Nazwy po polsku dla nowego kodu domenowego (jak w istniejących plikach), komentarze wyjaśniają „dlaczego", nie „co".
- Serwery deweloperskie działają (`scripts/start-all.ps1`); backend na `ts-node-dev --respawn` przeładowuje się sam.
- Komendy uruchamiać z `backend/` lub `frontend/` — nie z katalogu głównego.

---

### Task 1: Reguła agregacji `aggregateStyles`

**Files:**
- Modify: `backend/src/services/attributeService.ts` (dopisać po `styleFlags`, linia ~77)
- Test: `backend/src/services/__tests__/attributeService.test.ts` (dopisać nowy `describe`)

**Interfaces:**
- Consumes: `STYLES`, `Style` z tego samego pliku.
- Produces: `export function aggregateStyles(perVariant: Style[][]): Style[]` — używane przez Task 2 (backfill) i Task 4 (resolver).

- [ ] **Step 1: Write the failing test**

Dopisz na końcu `backend/src/services/__tests__/attributeService.test.ts`:

```ts
describe('aggregateStyles — głosy wariantów → style modelu', () => {
  it('większość głosów wygrywa', () => {
    expect(aggregateStyles([['nowoczesny'], ['nowoczesny'], ['klasyczny']])).toEqual(['nowoczesny'])
  })

  it('multi-label: każdy styl z większością przechodzi', () => {
    expect(
      aggregateStyles([
        ['nowoczesny', 'minimalistyczny'],
        ['nowoczesny', 'minimalistyczny'],
        ['nowoczesny'],
      ]),
    ).toEqual(['nowoczesny', 'minimalistyczny'])
  })

  it('brak większości → styl z największą liczbą głosów', () => {
    // klasyczny 2/4 to NIE większość (>50%), ale jest liderem
    expect(
      aggregateStyles([['klasyczny'], ['nowoczesny'], ['glamour'], ['klasyczny']]),
    ).toEqual(['klasyczny'])
  })

  it('remis liderów → wszyscy liderzy', () => {
    expect(aggregateStyles([['klasyczny'], ['nowoczesny']])).toEqual(['klasyczny', 'nowoczesny'])
  })

  it('pojedynczy wariant dyktuje styl modelu', () => {
    expect(aggregateStyles([['rustykalny']])).toEqual(['rustykalny'])
  })

  it('żaden wariant nie ma stylu → pusto (style_none)', () => {
    expect(aggregateStyles([[], [], []])).toEqual([])
  })

  it('brak wariantów → pusto', () => {
    expect(aggregateStyles([])).toEqual([])
  })

  it('szum jednego wariantu nie robi modelu rustykalnym', () => {
    // PORTA FIT model H.2: 19 wariantów, jeden opis ma "rustic touch"
    const głosy: Style[][] = Array.from({ length: 19 }, (_, i) =>
      i === 5 ? ['nowoczesny' as Style, 'rustykalny' as Style] : ['nowoczesny' as Style],
    )
    expect(aggregateStyles(głosy)).toEqual(['nowoczesny'])
  })
})
```

Uzupełnij import na górze pliku testowego — dopisz `aggregateStyles` do istniejącej listy importów z `'../attributeService'` oraz typ: `import type { Style } from '../attributeService'` (jeśli jeszcze go nie ma).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/attributeService.test.ts`
Expected: FAIL — `aggregateStyles is not a function` / błąd importu.

- [ ] **Step 3: Write minimal implementation**

W `backend/src/services/attributeService.ts`, zaraz po `styleFlags`:

```ts
// Styl to cecha MODELU, nie wariantu koloru: opisy wariantów tego samego modelu
// bywają sprzeczne ("modern" vs "modern, adding a rustic touch"), bo styl przykleja
// się do wybarwienia. Głosujemy: styl z większością głosów wygrywa. Gdy nikt nie ma
// większości, bierzemy lidera — dzięki temu model nie wpada do style_none, którego
// filtr nigdy nie chowa (a więc pokazywałby się pod KAŻDYM chipem stylu).
export function aggregateStyles(perVariant: Style[][]): Style[] {
  if (perVariant.length === 0) return []
  const głosy = new Map<Style, number>()
  for (const style of perVariant) {
    for (const s of style) głosy.set(s, (głosy.get(s) ?? 0) + 1)
  }
  if (głosy.size === 0) return []

  // Iterujemy po STYLES, żeby kolejność wyniku była kanoniczna (stabilne testy
  // i stabilne metadane), niezależna od kolejności wstawiania do mapy.
  const większość = STYLES.filter((s) => (głosy.get(s) ?? 0) * 2 > perVariant.length)
  if (większość.length > 0) return [...większość]

  const max = Math.max(...głosy.values())
  return STYLES.filter((s) => (głosy.get(s) ?? 0) === max)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/attributeService.test.ts`
Expected: PASS (wszystkie testy pliku, w tym istniejące).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/attributeService.ts backend/src/services/__tests__/attributeService.test.ts
git commit -m "feat(style): aggregateStyles - wiekszosc glosow wariantow, inaczej lider"
```

---

### Task 2: Backfill — spójne flagi stylu dla całego katalogu

**Files:**
- Modify: `backend/src/scripts/backfillStyle.ts` (przepisanie całości)
- Test: brak testu jednostkowego (skrypt operacyjny); weryfikacja przez uruchomienie i kontrolę spójności w Step 4

**Interfaces:**
- Consumes: `aggregateStyles`, `classifyStyles`, `styleFlags` z `attributeService`; `modelOf` z `glassResolver`; `categorizeDoor` z `chromaService`.
- Produces: dane w Chromie — wszystkie warianty jednego modelu mają identyczne flagi `style_*` i `style_none`.

- [ ] **Step 1: Przepisz skrypt na agregację per model**

Zastąp CAŁĄ zawartość `backend/src/scripts/backfillStyle.ts`:

```ts
// Nadaje flagi style_* wszystkim residential — jedna decyzja NA MODEL, propagowana
// na warianty kolorystyczne. Metadane-only: bez embeddingu, bez Gemini, bez wizji.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/backfillStyle.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { aggregateStyles, classifyStyles, styleFlags } from '../services/attributeService'
import { modelOf } from '../services/glassResolver'
import { categorizeDoor } from '../services/chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

interface Rekord {
  id: string
  meta: Record<string, unknown>
}

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // 1. Wczytaj cały katalog i zgrupuj residential po modelu.
  const byModel = new Map<string, Rekord[]>()
  let scanned = 0
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const meta = (r.metadatas[i] ?? {}) as Record<string, unknown>
      scanned++
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push({ id, meta })
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[STYLE] Przeskanowano ${scanned}, residential w ${byModel.size} modelach`)

  // 2. Głosowanie per model → identyczne flagi dla wszystkich wariantów.
  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  const byStyle: Record<string, number> = {}
  for (const [, warianty] of byModel) {
    const style = aggregateStyles(warianty.map((w) => classifyStyles(String(w.meta.description ?? ''))))
    const flags = styleFlags(style)
    const key = style.length ? style.join('+') : '(none)'
    byStyle[key] = (byStyle[key] ?? 0) + warianty.length
    for (const w of warianty) {
      // Aktualizujemy tylko rekordy, którym flagi się zmieniają — mniej zapisu.
      const różni = Object.entries(flags).some(([k, v]) => w.meta[k] !== v)
      if (!różni) continue
      ids.push(w.id)
      metas.push({ ...w.meta, ...flags })
    }
  }
  console.log(`[STYLE] Do aktualizacji ${ids.length} rekordów`)

  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
    console.log(`[STYLE] zaktualizowano ${Math.min(i + 200, ids.length)}/${ids.length}`)
  }

  console.log('[STYLE] Rozkład (kombinacja → warianty):')
  for (const [k, n] of Object.entries(byStyle).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`)
  }
  console.log('[STYLE] GOTOWE.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Uruchom backfill**

Run: `cd backend && npx ts-node --transpile-only src/scripts/backfillStyle.ts`
Expected: log `residential w 580 modelach`, kilka tysięcy zaktualizowanych rekordów, rozkład kombinacji stylów, `GOTOWE`.

- [ ] **Step 3: Napisz skrypt kontroli spójności**

Utwórz `backend/src/scripts/checkStyleConsistency.ts`:

```ts
// Kontrola po backfillu: czy WSZYSTKIE warianty modelu mają identyczne flagi stylu.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/checkStyleConsistency.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { STYLES } from '../services/attributeService'
import { modelOf } from '../services/glassResolver'
import { categorizeDoor } from '../services/chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })
  const byModel = new Map<string, Record<string, unknown>[]>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.metadatas.forEach((m: any) => {
      const meta = (m ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push(meta)
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  const klucze = [...STYLES.map((s) => 'style_' + s), 'style_none']
  let niespójne = 0
  const licznik: Record<string, number> = {}
  for (const [model, warianty] of byModel) {
    const wzorzec = klucze.map((k) => warianty[0][k]).join(',')
    if (warianty.some((w) => klucze.map((k) => w[k]).join(',') !== wzorzec)) {
      niespójne++
      console.log(`  NIESPÓJNY: ${model}`)
    }
    for (const s of STYLES) {
      if (warianty[0]['style_' + s] === true) licznik[s] = (licznik[s] ?? 0) + warianty.length
    }
    if (warianty[0].style_none === true) licznik['(none)'] = (licznik['(none)'] ?? 0) + warianty.length
  }
  console.log(`\nmodeli: ${byModel.size} | niespójnych: ${niespójne}`)
  console.log('warianty per styl:', JSON.stringify(licznik))
  if (niespójne > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 4: Uruchom kontrolę spójności**

Run: `cd backend && npx ts-node --transpile-only src/scripts/checkStyleConsistency.ts`
Expected: `niespójnych: 0`, exit 0. Liczby zbliżone do specyfikacji (rustykalny ~97, loft ~243, skandynawski ~3, bez stylu ~26). Jeśli `niespójnych > 0` — backfill nie objął części rekordów; sprawdź, czy `categorizeDoor` nie odsiał wariantów tego samego modelu.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scripts/backfillStyle.ts backend/src/scripts/checkStyleConsistency.ts
git commit -m "feat(style): backfill nadaje styl per model + skrypt kontroli spojnosci"
```

---

### Task 3: Indeks przekrojów `styleIndex`

**Files:**
- Create: `backend/src/services/styleIndex.ts`
- Test: `backend/src/services/__tests__/styleIndex.test.ts`

**Interfaces:**
- Consumes: `STYLES`, `Style`, `finishMatches` z `attributeService`; typ `HardFilters` z `chromaService` (import typu — bez cyklu runtime).
- Produces:
  - `export interface WierszIndeksu { name: string; colorFamily?: string; hasGlass?: boolean; styles: Style[] }`
  - `export function countStylesIn(rows: WierszIndeksu[], filters?: HardFilters): Record<Style, number>` (czysta)
  - `export async function countStyles(filters?: HardFilters): Promise<Record<Style, number>>`
  - `export function invalidateStyleIndex(): void` — woła Task 4.

- [ ] **Step 1: Write the failing test**

Utwórz `backend/src/services/__tests__/styleIndex.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { countStylesIn } from '../styleIndex'
import type { WierszIndeksu } from '../styleIndex'

const KATALOG: WierszIndeksu[] = [
  { name: 'PORTA A model 1 - Biały', colorFamily: 'white', hasGlass: false, styles: ['klasyczny'] },
  { name: 'PORTA A model 1 - Dąb Ciemny', colorFamily: 'dark_wood', hasGlass: false, styles: ['klasyczny'] },
  { name: 'PORTA B model 2 z szybą - Biały', colorFamily: 'white', hasGlass: true, styles: ['nowoczesny', 'minimalistyczny'] },
  { name: 'NATURA VERDINO model V.1 - Orzech Ciemny', colorFamily: 'dark_wood', hasGlass: false, styles: ['rustykalny'] },
  { name: 'PORTA C model 3 - Biały', colorFamily: 'white', hasGlass: false, styles: [] },
]

describe('countStylesIn', () => {
  it('bez filtrów liczy cały katalog', () => {
    const c = countStylesIn(KATALOG)
    expect(c.klasyczny).toBe(2)
    expect(c.nowoczesny).toBe(1)
    expect(c.minimalistyczny).toBe(1)
    expect(c.rustykalny).toBe(1)
    expect(c.loft).toBe(0)
  })

  it('drzwi bezstylowe nie liczą się do żadnego stylu', () => {
    const c = countStylesIn([KATALOG[4]])
    expect(Object.values(c).every((n) => n === 0)).toBe(true)
  })

  it('filtr koloru zawęża liczby', () => {
    const c = countStylesIn(KATALOG, { colors: ['white'] })
    expect(c.klasyczny).toBe(1)
    expect(c.rustykalny).toBe(0) // brak białych rustykalnych — chip do wygaszenia
  })

  it('filtr szkła zawęża liczby', () => {
    const c = countStylesIn(KATALOG, { glass: true })
    expect(c.nowoczesny).toBe(1)
    expect(c.klasyczny).toBe(0)
  })

  it('filtr wybarwienia działa po nazwie wariantu', () => {
    const c = countStylesIn(KATALOG, { finish: 'orzech' })
    expect(c.rustykalny).toBe(1)
    expect(c.klasyczny).toBe(0)
  })

  it('filtr stylu jest ignorowany — liczymy przekrój BEZ niego', () => {
    const c = countStylesIn(KATALOG, { style: 'loft' })
    expect(c.klasyczny).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/styleIndex.test.ts`
Expected: FAIL — nie można rozwiązać modułu `../styleIndex`.

- [ ] **Step 3: Write minimal implementation**

Utwórz `backend/src/services/styleIndex.ts`:

```ts
// Liczniki trafień per styl dla chipów: „ile jest białych klasycznych" liczymy
// z lekkiego indeksu metadanych w pamięci (wzorzec nameIndex z chromaService).
// Zmierzone: 7 zapytań do Chromy z where kosztuje 330–375 ms na wyszukiwanie,
// skan indeksu 71 ms. Indeks unieważnia import/sync/backfill (styleResolver).
import { ChromaClient } from 'chromadb'
import { STYLES, finishMatches } from './attributeService'
import type { Style } from './attributeService'
import type { HardFilters, ProductMetadata } from './chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const BATCH = 500

export interface WierszIndeksu {
  name: string
  colorFamily?: string
  hasGlass?: boolean
  styles: Style[]
}

function pusteLiczniki(): Record<Style, number> {
  return Object.fromEntries(STYLES.map((s) => [s, 0])) as Record<Style, number>
}

/**
 * Trafienia ŚCISŁE per styl przy pozostałych twardych filtrach. Filtr stylu jest
 * świadomie ignorowany — liczymy przekrój, w którym chip dopiero ma być kliknięty.
 * Drzwi bezstylowe dają 0 wszędzie: chip ma mówić „ile jest takich drzwi",
 * a nie „ile zobaczę po doliczeniu bezstylowych".
 */
export function countStylesIn(rows: WierszIndeksu[], filters?: HardFilters): Record<Style, number> {
  const liczniki = pusteLiczniki()
  for (const r of rows) {
    if (filters?.colors && filters.colors.length > 0 && !filters.colors.includes(r.colorFamily ?? '')) {
      continue
    }
    if ((filters?.glass === true || filters?.glass === false) && r.hasGlass !== filters.glass) {
      continue
    }
    if (filters?.finish && !finishMatches(r.name, filters.finish)) continue
    for (const s of r.styles) liczniki[s]++
  }
  return liczniki
}

let indeks: WierszIndeksu[] | null = null

export function invalidateStyleIndex(): void {
  indeks = null
}

async function getIndeks(): Promise<WierszIndeksu[]> {
  if (indeks) return indeks

  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })
  const zbudowany: WierszIndeksu[] = []
  let offset = 0
  while (true) {
    const r = await col.get({ limit: BATCH, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    for (const m of r.metadatas) {
      const meta = (m ?? {}) as unknown as ProductMetadata
      if (meta.category !== 'residential') continue
      zbudowany.push({
        name: meta.name,
        colorFamily: meta.color_family,
        hasGlass: meta.has_glass,
        styles: STYLES.filter((s) => (meta as Record<string, unknown>)['style_' + s] === true),
      })
    }
    offset += r.ids.length
    if (r.ids.length < BATCH) break
  }

  indeks = zbudowany
  console.log(`[STYLE-INDEX] Zbudowano indeks: ${zbudowany.length} residential`)
  return zbudowany
}

export async function countStyles(filters?: HardFilters): Promise<Record<Style, number>> {
  return countStylesIn(await getIndeks(), filters)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/styleIndex.test.ts`
Expected: PASS (6 testów).

- [ ] **Step 5: Sprawdź indeks na żywych danych**

Utwórz `backend/src/scripts/_probeStyleCounts.ts`:

```ts
import 'dotenv/config'
import { countStyles } from '../services/styleIndex'

async function main() {
  const t0 = Date.now()
  console.log('bez filtrów :', JSON.stringify(await countStyles()))
  console.log(`budowa+liczenie: ${Date.now() - t0} ms`)
  const t1 = Date.now()
  console.log('białe       :', JSON.stringify(await countStyles({ colors: ['white'] })))
  console.log(`kolejne liczenie: ${Date.now() - t1} ms`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

Run: `cd backend && npx ts-node --transpile-only src/scripts/_probeStyleCounts.ts`
Expected: dla białych `"rustykalny":0`, `"nowoczesny"` > 0; drugie liczenie poniżej 150 ms (indeks z pamięci).
Potem usuń sondę: `rm backend/src/scripts/_probeStyleCounts.ts`

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/styleIndex.ts backend/src/services/__tests__/styleIndex.test.ts
git commit -m "feat(style): indeks przekrojow w pamieci - liczniki trafien per styl"
```

---

### Task 4: `styleResolver` — spójność stylu przy imporcie

**Files:**
- Create: `backend/src/services/styleResolver.ts`
- Test: `backend/src/services/__tests__/styleResolver.test.ts`
- Modify: `backend/src/services/importService.ts:107` (obok wywołania `resolveGlassForProducts`)
- Modify: `backend/src/scripts/syncCatalog.ts:140` (obok wywołania `resolveGlassForProducts`)

**Interfaces:**
- Consumes: `aggregateStyles`, `classifyStyles`, `styleFlags` (Task 1), `invalidateStyleIndex` (Task 3), `modelOf` z `glassResolver`, `categorizeDoor` z `chromaService`.
- Produces:
  - `export function stylesForModel(descriptions: string[]): Style[]`
  - `export interface WynikStylu { models: number; updated: number }`
  - `export async function resolveStylesForProducts(nowe: Array<{ id: string; name: string }>): Promise<WynikStylu>`

- [ ] **Step 1: Write the failing test**

Utwórz `backend/src/services/__tests__/styleResolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { stylesForModel } from '../styleResolver'

describe('stylesForModel — opisy wariantów modelu → styl modelu', () => {
  it('większość opisów decyduje', () => {
    expect(
      stylesForModel([
        'modern residential interior door light oak',
        'modern residential interior door white',
        'classic raised panel residential door',
      ]),
    ).toEqual(['nowoczesny'])
  })

  it('pojedyncza wzmianka o rustic nie robi modelu rustykalnym', () => {
    const opisy = [
      'modern residential interior door light oak',
      'modern residential interior door natural oak',
      'modern design, honey acacia veneer, adding a rustic touch',
    ]
    expect(stylesForModel(opisy)).toEqual(['nowoczesny'])
  })

  it('model realnie rustykalny zostaje rustykalny', () => {
    const opisy = [
      'rustic knotty pine residential door',
      'rustic farmhouse style residential door',
      'rustic residential interior door',
    ]
    expect(stylesForModel(opisy)).toEqual(['rustykalny'])
  })

  it('opisy bez sygnału stylu → pusto', () => {
    expect(stylesForModel(['residential interior door', 'interior door white'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/__tests__/styleResolver.test.ts`
Expected: FAIL — nie można rozwiązać modułu `../styleResolver`.

- [ ] **Step 3: Write minimal implementation**

Utwórz `backend/src/services/styleResolver.ts`:

```ts
// Utrzymuje styl jako cechę MODELU przy imporcie — bliźniak glassResolver, ale
// bez wizji i bez Gemini (styl czytamy z opisu EN). Nowy wariant koloru nie może
// rozjechać stylu modelu: przeliczamy głosy ze WSZYSTKICH wariantów, także tych
// już leżących w bazie, i zapisujemy identyczne flagi całej rodzinie.
import { ChromaClient } from 'chromadb'
import { aggregateStyles, classifyStyles, styleFlags } from './attributeService'
import type { Style } from './attributeService'
import { categorizeDoor } from './chromaService'
import { modelOf } from './glassResolver'
import { invalidateStyleIndex } from './styleIndex'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const BATCH = 500

export interface WynikStylu {
  models: number
  updated: number
}

/** Opisy wariantów jednego modelu → style modelu. Czysta, bez sieci. */
export function stylesForModel(descriptions: string[]): Style[] {
  return aggregateStyles(descriptions.map((d) => classifyStyles(d)))
}

export async function resolveStylesForProducts(
  nowe: Array<{ id: string; name: string }>,
): Promise<WynikStylu> {
  const result: WynikStylu = { models: 0, updated: 0 }
  const residential = nowe.filter((p) => categorizeDoor(p.name) === 'residential')
  if (residential.length === 0) return result

  // Modele dotknięte importem — tylko one wymagają przeliczenia.
  const dotknięte = new Set(residential.map((p) => modelOf(p.name)))

  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // Jeden odczyt kolekcji: Chroma nie filtruje po prefiksie nazwy, więc rodzeństwo
  // modelu (istniejące warianty) da się zebrać tylko skanem.
  const byModel = new Map<string, Array<{ id: string; meta: Record<string, unknown> }>>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: BATCH, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const meta = (r.metadatas[i] ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!dotknięte.has(model)) return
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push({ id, meta })
    })
    offset += r.ids.length
    if (r.ids.length < BATCH) break
  }

  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  for (const [, warianty] of byModel) {
    result.models++
    const flags = styleFlags(stylesForModel(warianty.map((w) => String(w.meta.description ?? ''))))
    for (const w of warianty) {
      if (!Object.entries(flags).some(([k, v]) => w.meta[k] !== v)) continue
      ids.push(w.id)
      metas.push({ ...w.meta, ...flags })
    }
  }

  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
  }
  result.updated = ids.length

  // Katalog się zmienił — liczniki chipów muszą przeliczyć się od nowa.
  invalidateStyleIndex()
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/__tests__/styleResolver.test.ts`
Expected: PASS (4 testy).

- [ ] **Step 5: Wepnij w import z UI**

W `backend/src/services/importService.ts` dopisz import na górze (obok istniejącego `import { resolveGlassForProducts } from './glassResolver'`):

```ts
import { resolveStylesForProducts } from './styleResolver'
```

Następnie w bloku `if (dodane.length > 0) { ... }` — zaraz po `catch` wywołania szkła (obecnie linia ~112, po zamknięciu bloku try/catch szkła, wciąż wewnątrz `if`) dopisz:

```ts
    try {
      const style = await resolveStylesForProducts(dodane)
      console.log(`[IMPORT] Styl: ${style.updated} rekordów w ${style.models} modelach`)
    } catch (err) {
      console.warn('[IMPORT] Styl per model padł (pomijam):', err instanceof Error ? err.message : err)
    }
```

- [ ] **Step 6: Wepnij w sync katalogu**

W `backend/src/scripts/syncCatalog.ts` dopisz import (obok `resolveGlassForProducts`):

```ts
import { resolveStylesForProducts } from '../services/styleResolver'
```

i w bloku `if (dodane.length > 0) { ... }` (linia ~137), po try/catch szkła:

```ts
    try {
      const style = await resolveStylesForProducts(dodane)
      console.log(`[SYNC] Styl: ${style.updated} rekordów w ${style.models} modelach`)
    } catch (err) {
      console.warn('[SYNC] Styl per model padł (pomijam):', err instanceof Error ? err.message : err)
    }
```

- [ ] **Step 7: Weryfikacja typów i pełny zestaw testów**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` bez wyjścia; vitest — wszystkie testy zielone (poprzednio 134, teraz +18).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/styleResolver.ts backend/src/services/__tests__/styleResolver.test.ts backend/src/services/importService.ts backend/src/scripts/syncCatalog.ts
git commit -m "feat(style): styleResolver utrzymuje styl per model przy imporcie i sync"
```

---

### Task 5: Trasa wyszukiwania — `styleCounts` i pominięcie stylu z komunikatem

**Files:**
- Create: `backend/src/routes/searchNotices.ts`
- Test: `backend/src/routes/__tests__/searchNotices.test.ts`
- Modify: `backend/src/routes/search.ts` (usunąć `FINISH_PL` z linii 52–62, zmienić `buildResultPayload` z linii 64–91, dopisać liczniki w obu trasach)

**Interfaces:**
- Consumes: `countStyles` (Task 3), `Style`, `STYLES` z `attributeService`.
- Produces:
  - `export function buildNotice(droppedFinish?: string, droppedStyle?: string): string | undefined`
  - odpowiedź wyszukiwania zyskuje pole `styleCounts: Record<Style, number>` (używa go Task 6).

**Uwaga do specyfikacji:** spec podawał przykładowe zdanie „W białych nie ma drzwi rustykalnych…". `filters.colors` bywa listą kilku rodzin (guard drewna ustawia trzy naraz), więc nazwanie koloru w zdaniu byłoby zgadywaniem. Komunikat mówi tylko o stylu — dokładnie jak istniejący komunikat o wybarwieniu.

- [ ] **Step 1: Write the failing test**

Utwórz `backend/src/routes/__tests__/searchNotices.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildNotice } from '../searchNotices'

describe('buildNotice', () => {
  it('brak pominiętych filtrów → brak komunikatu', () => {
    expect(buildNotice()).toBeUndefined()
  })

  it('pominięte wybarwienie', () => {
    const n = buildNotice('orzech')
    expect(n).toContain('orzech')
    expect(n).toContain('zbliżone kolorystycznie')
  })

  it('pominięty styl', () => {
    const n = buildNotice(undefined, 'rustykalny')
    expect(n).toContain('rustykalnym')
    expect(n).toContain('bez filtra stylu')
  })

  it('oba pominięte → dwa zdania w jednym polu', () => {
    const n = buildNotice('dab', 'loft')!
    expect(n).toContain('dąb')
    expect(n).toContain('loftowym')
    expect(n.split('—').length).toBeGreaterThan(2)
  })

  it('nieznany klucz stylu nie wywraca komunikatu', () => {
    expect(buildNotice(undefined, 'nieznany')).toContain('nieznany')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/routes/__tests__/searchNotices.test.ts`
Expected: FAIL — nie można rozwiązać modułu `../searchNotices`.

- [ ] **Step 3: Write minimal implementation**

Utwórz `backend/src/routes/searchNotices.ts`:

```ts
// Komunikaty o POMINIĘTYCH filtrach. Cicha podmiana kryteriów wygląda jak awaria
// wyszukiwarki i kosztuje zaufanie, więc każdy odrzucony filtr ma własne zdanie.

// Klucz techniczny wybarwienia → nazwa, którą klient sam by wypowiedział.
const FINISH_PL: Record<string, string> = {
  orzech: 'orzech',
  dab: 'dąb',
  jesion: 'jesion',
  akacja: 'akacja',
  sosna: 'sosna',
  buk: 'buk',
  wenge: 'wenge',
  hikora: 'hikora',
}

// Enum stylu → przymiotnik w miejscowniku ("w stylu rustykalnym").
const STYLE_PL: Record<string, string> = {
  klasyczny: 'klasycznym',
  nowoczesny: 'nowoczesnym',
  minimalistyczny: 'minimalistycznym',
  rustykalny: 'rustykalnym',
  loft: 'loftowym',
  skandynawski: 'skandynawskim',
  glamour: 'glamour',
}

export function buildNotice(droppedFinish?: string, droppedStyle?: string): string | undefined {
  const zdania: string[] = []
  if (droppedFinish) {
    zdania.push(
      `Nie mamy drzwi w wybarwieniu „${FINISH_PL[droppedFinish] ?? droppedFinish}” przy pozostałych kryteriach — pokazujemy zbliżone kolorystycznie.`,
    )
  }
  if (droppedStyle) {
    zdania.push(
      `Nie mamy drzwi w stylu ${STYLE_PL[droppedStyle] ?? droppedStyle} przy pozostałych kryteriach — pokazujemy wyniki bez filtra stylu.`,
    )
  }
  return zdania.length > 0 ? zdania.join(' ') : undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/routes/__tests__/searchNotices.test.ts`
Expected: PASS (5 testów).

- [ ] **Step 5: Podłącz komunikaty i liczniki w `search.ts`**

W `backend/src/routes/search.ts`:

(a) Do importów dopisz:

```ts
import { countStyles } from '../services/styleIndex'
import { buildNotice } from './searchNotices'
```

(b) Usuń całą stałą `FINISH_PL` (linie 52–62) — przeniosła się do `searchNotices.ts`.

(c) Zastąp `buildResultPayload` (linie 64–91):

```ts
function buildResultPayload(
  description: DoorDescription | null,
  results: SearchResultItem[],
  isLowSimilarity: boolean,
  droppedFinish?: string,
  droppedStyle?: Style,
  styleCounts?: Record<Style, number>,
) {
  const notice = buildNotice(droppedFinish, droppedStyle)
  if (results.length === 0) {
    return {
      products: [],
      description: description?.clipQuery,
      displayDescription: description?.displayPl,
      status: 'empty-catalog' as const,
      notice,
      styleCounts,
    }
  }
  return {
    products: toProducts(results),
    description: description?.clipQuery,
    displayDescription: description?.displayPl,
    status: isLowSimilarity ? ('low-similarity' as const) : ('success' as const),
    notice,
    styleCounts,
  }
}
```

(d) W trasie `/search` (wyszukiwanie ze zdjęcia), zastąp linie 164–167:

```ts
    // Liczniki chipów liczymy zawsze — front wygasza style bez trafień, zanim
    // użytkownik w nie kliknie. Filtr stylu wykluczony: liczymy przekrój, w
    // którym chip dopiero ma być kliknięty.
    const styleCounts = await countStyles({ ...description?.filters, style: null })
    let filters = description?.filters
    let droppedStyle: Style | undefined
    if (filters?.style && styleCounts[filters.style] === 0) {
      droppedStyle = filters.style
      filters = { ...filters, style: null }
      console.warn(`[SEARCH] Brak drzwi w stylu "${droppedStyle}" — pomijam filtr`)
    }
    const { results, isLowSimilarity } = await searchSimilar(embedding, 10, filters, seed)
    console.log(`[SEARCH] Got ${results.length} results, isLowSimilarity=${isLowSimilarity}`)

    const payload = buildResultPayload(
      description,
      results,
      isLowSimilarity,
      undefined,
      droppedStyle,
      styleCounts,
    )
```

(e) W trasie `/search-text`, zastąp linie 265–279 (od `send({ type: 'progress', stage: 'matching' })` do zamknięcia `send({ type: 'result', ... })`):

```ts
    send({ type: 'progress', stage: 'matching' })
    const embedding = await getTextEmbedding(description.clipQuery)
    console.log(`[SEARCH-TEXT] Filters: ${JSON.stringify(description.filters)}`)
    const seed = createHash('sha256').update(query).digest('hex')

    const styleCounts = await countStyles({ ...description.filters, style: null })
    let filters = description.filters
    let droppedStyle: Style | undefined
    if (filters?.style && styleCounts[filters.style] === 0) {
      // Bez tego $or [styl, style_none] degeneruje do garstki drzwi bezstylowych,
      // które ze stylem nie mają nic wspólnego (zgłoszenie: „pokazuje stalowe").
      droppedStyle = filters.style
      filters = { ...filters, style: null }
      console.warn(`[SEARCH-TEXT] Brak drzwi w stylu "${droppedStyle}" — pomijam filtr`)
    }

    const { results, isLowSimilarity, droppedFinish } = await searchSimilar(
      embedding,
      10,
      filters,
      seed,
    )

    send({
      type: 'result',
      data: buildResultPayload(
        description,
        results,
        isLowSimilarity,
        droppedFinish,
        droppedStyle,
        styleCounts,
      ),
    })
```

- [ ] **Step 6: Weryfikacja typów i testów**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` bez wyjścia, wszystkie testy zielone.

- [ ] **Step 7: Sprawdź trasę na żywo**

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"czarne drzwi rustykalne\"}" | tail -2
```
Expected: w zdarzeniu `result` pole `styleCounts` z `"rustykalny":0` oraz `notice` zawierające „Nie mamy drzwi w stylu rustykalnym". Wyniki NIE zawierają `PORTA Steel EI 60 Plus`.

> Czarne, nie białe: po backfillu z Taska 2 białe rustykalne ISTNIEJĄ (9 sztuk — warianty „Dąb Biały" modeli VECTOR, OSLO, LOFT 7.1, RESIST, które wcześniej gubiły styl). To zamierzony efekt poprawki. Pusty pozostaje przekrój `black × rustykalny` (0 rekordów, potwierdzone macierzą kolor×styl).

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/searchNotices.ts backend/src/routes/__tests__/searchNotices.test.ts backend/src/routes/search.ts
git commit -m "feat(style): styleCounts w odpowiedzi + pominiecie pustego filtra stylu z komunikatem"
```

---

### Task 6: Front — chipy stylu z licznikiem i wygaszaniem

**Files:**
- Modify: `frontend/src/types/index.ts` (interfejs `SearchResult`)
- Modify: `frontend/src/lib/refinement.ts` (dopisać dwie czyste funkcje na końcu)
- Test: `frontend/src/lib/__tests__/refinement.test.ts` (dopisać `describe`)
- Modify: `frontend/src/components/Rail.tsx` (wyciągnąć `ChipButton`, użyć w obu rzędach)
- Modify: `frontend/src/App.tsx:124-136` (przekazać `styleCounts` do `Rail`)

**Interfaces:**
- Consumes: `SearchResult.styleCounts` z Task 5.
- Produces:
  - `export function liczbaChipa(etykieta: string, counts?: Record<string, number>): number | undefined`
  - `export function chipWygaszony(etykieta: string, grupa: Grupa, stan: StanZapytania, counts?: Record<string, number>): boolean`
  - `RailProps.styleCounts?: Record<string, number>`

**Uwaga:** front nie ma `@testing-library/react` ani środowiska `jsdom` (`vite.config.ts` → `test.environment: 'node'`). Dlatego logika wygaszania mieszka w czystych funkcjach w `refinement.ts` i tam jest testowana — bez dokładania zależności.

- [ ] **Step 1: Write the failing test**

Dopisz na końcu `frontend/src/lib/__tests__/refinement.test.ts`:

```ts
describe('liczbaChipa', () => {
  it('zwraca liczbę dla chipa stylu', () => {
    expect(liczbaChipa('rustykalne', { rustykalny: 0, klasyczny: 138 })).toBe(0)
    expect(liczbaChipa('klasyczne', { rustykalny: 0, klasyczny: 138 })).toBe(138)
  })

  it('brak liczników → undefined (chipy jak dotąd)', () => {
    expect(liczbaChipa('rustykalne', undefined)).toBeUndefined()
  })

  it('chip spoza grupy styl nie ma liczby', () => {
    expect(liczbaChipa('ze szkłem', { rustykalny: 0 })).toBeUndefined()
  })
})

describe('chipWygaszony', () => {
  const pusty: StanZapytania = { baza: 'białe drzwi', kroki: [] }

  it('zero trafień → wygaszony', () => {
    expect(chipWygaszony('rustykalne', 'styl', pusty, { rustykalny: 0 })).toBe(true)
  })

  it('są trafienia → aktywny', () => {
    expect(chipWygaszony('klasyczne', 'styl', pusty, { klasyczny: 138 })).toBe(false)
  })

  it('aktywny chip nigdy nie jest wygaszony — musi dać się odkliknąć', () => {
    const zeStylem = dodajKrok(pusty, 'rustykalne', 'styl')
    expect(chipWygaszony('rustykalne', 'styl', zeStylem, { rustykalny: 0 })).toBe(false)
  })

  it('brak liczników → nic nie wygaszamy', () => {
    expect(chipWygaszony('rustykalne', 'styl', pusty, undefined)).toBe(false)
  })

  it('chipy spoza grupy styl nigdy nie są wygaszane', () => {
    expect(chipWygaszony('ze szkłem', 'szkło', pusty, { rustykalny: 0 })).toBe(false)
  })
})
```

Uzupełnij import na górze pliku testowego: dopisz `liczbaChipa`, `chipWygaszony` (oraz `dodajKrok`, jeśli go tam jeszcze nie ma) do importu z `'../refinement'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/refinement.test.ts`
Expected: FAIL — `liczbaChipa is not a function`.

- [ ] **Step 3: Write minimal implementation**

Dopisz na końcu `frontend/src/lib/refinement.ts`:

```ts
// Liczba trafień dla chipa stylu (backend liczy przekrój bez filtra stylu).
// Chipy spoza grupy „styl" liczników nie mają — świadomie, zakres decyzji.
export function liczbaChipa(
  etykieta: string,
  counts?: Record<string, number>,
): number | undefined {
  if (!counts) return undefined
  const enumStylu = STYLE_LABELS[etykieta]
  return enumStylu ? counts[enumStylu] : undefined
}

// Chip bez trafień jest nieklikalny — inaczej filtr degeneruje do drzwi
// bezstylowych i użytkownik dostaje wyniki bez związku ze stylem. Aktywny chip
// zostaje klikalny zawsze, bo musi dać się odkliknąć.
export function chipWygaszony(
  etykieta: string,
  grupa: Grupa,
  stan: StanZapytania,
  counts?: Record<string, number>,
): boolean {
  if (czyAktywny(stan, etykieta, grupa)) return false
  return liczbaChipa(etykieta, counts) === 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/__tests__/refinement.test.ts`
Expected: PASS (istniejące + 9 nowych).

- [ ] **Step 5: Rozszerz typ odpowiedzi**

W `frontend/src/types/index.ts`, w interfejsie `SearchResult` po polu `notice`:

```ts
  /** trafienia per styl przy obecnych filtrach — do liczb i wygaszania chipów */
  styleCounts?: Record<string, number>
```

- [ ] **Step 6: Wyciągnij `ChipButton` i podłącz liczniki w `Rail.tsx`**

W `frontend/src/components/Rail.tsx`:

(a) Zmień import z `@/lib/refinement` na:

```ts
import { CHIPY, czyAktywny, liczbaChipa, chipWygaszony } from '@/lib/refinement'
```

(b) Dopisz komponent nad `export function Rail` (po `interface RailProps`):

```ts
interface ChipButtonProps {
  etykieta: string
  aktywny: boolean
  disabled: boolean
  count?: number
  brakTrafien: boolean
  onClick: () => void
}

// Jeden chip — wspólny dla rzędu jasność/szkło/materiał i dla rzędu stylu.
function ChipButton({ etykieta, aktywny, disabled, count, brakTrafien, onClick }: ChipButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={aktywny}
      title={brakTrafien ? 'brak przy obecnych filtrach' : undefined}
      onClick={onClick}
      className={
        aktywny
          ? 'rounded-full border border-brass bg-brass px-3.5 py-1.5 text-[13px] font-medium text-paper transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
          : 'rounded-full border border-linen bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brass hover:bg-brass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
      }
    >
      {etykieta}
      {count !== undefined && (
        <span className={aktywny ? 'ml-1.5 text-paper/70' : 'ml-1.5 text-ink-soft'}>{count}</span>
      )}
    </button>
  )
}
```

(c) Dopisz do `RailProps` (po `validationError`):

```ts
  styleCounts?: Record<string, number>
```

i do destrukturyzacji propsów w `export function Rail({ ... })` — dopisz `styleCounts,` po `validationError,`.

(d) Zastąp pierwszy rząd chipów (obecnie linie 138–158):

```tsx
      <div className="flex flex-wrap gap-2" role="group" aria-label="Doprecyzuj wyszukiwanie">
        {CHIPY.filter((c) => c.grupa !== 'styl').map((chip) => (
          <ChipButton
            key={chip.etykieta}
            etykieta={chip.etykieta}
            aktywny={czyAktywny(stan, chip.etykieta, chip.grupa)}
            disabled={busy}
            brakTrafien={false}
            onClick={() => onChip(chip.etykieta, chip.grupa)}
          />
        ))}
      </div>
```

(e) Zastąp rząd stylu (obecnie linie 160–183):

```tsx
      <div role="group" aria-label="Styl">
        <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft">Styl</p>
        <div className="flex flex-wrap gap-2">
          {CHIPY.filter((c) => c.grupa === 'styl').map((chip) => {
            const wygaszony = chipWygaszony(chip.etykieta, chip.grupa, stan, styleCounts)
            return (
              <ChipButton
                key={chip.etykieta}
                etykieta={chip.etykieta}
                aktywny={czyAktywny(stan, chip.etykieta, chip.grupa)}
                disabled={busy || wygaszony}
                count={liczbaChipa(chip.etykieta, styleCounts)}
                brakTrafien={wygaszony}
                onClick={() => onChip(chip.etykieta, chip.grupa)}
              />
            )
          })}
        </div>
      </div>
```

- [ ] **Step 7: Przekaż liczniki z `App.tsx`**

W `frontend/src/App.tsx`, w wywołaniu `<Rail ... />` (linie 124–136) dopisz po `validationError={validationError}`:

```tsx
              styleCounts={searchResult?.styleCounts}
```

- [ ] **Step 8: Weryfikacja frontu**

Run: `cd frontend && npx vitest run && npm run build`
Expected: testy zielone (33 + 9), build zielony (skrypt `build` = `tsc -b && vite build`, więc typy są sprawdzane).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/lib/refinement.ts frontend/src/lib/__tests__/refinement.test.ts frontend/src/components/Rail.tsx frontend/src/App.tsx
git commit -m "feat(ui): chipy stylu z liczba trafien, wygaszone gdy zero"
```

---

### Task 7: Weryfikacja end-to-end i regresja

**Files:**
- Brak zmian w kodzie (o ile weryfikacja nie wykryje usterki)

**Interfaces:**
- Consumes: wszystko z Tasków 1–6.
- Produces: potwierdzenie definicji ukończenia ze specyfikacji.

- [ ] **Step 1: Spójność wariantów po backfillu**

Run: `cd backend && npx ts-node --transpile-only src/scripts/checkStyleConsistency.ts`
Expected: `niespójnych: 0`.

- [ ] **Step 2: Filtr rustykalny zawęża ostro**

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"drzwi rustykalne\",\"style\":\"rustykalny\"}" | tail -2
```
Expected: nazwy z listy rustykalnych modeli (VERDINO, PORTA LOFT model 4.A, RESIST, „4 Żywioły Ziemia"); brak `notice` o pominiętym stylu.

- [ ] **Step 3: Pusty przekrój daje komunikat, nie drzwi stalowe**

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"czarne drzwi rustykalne\",\"style\":\"rustykalny\"}" | tail -2
```
Expected: `notice` z „Nie mamy drzwi w stylu rustykalnym", `styleCounts` z `"rustykalny":0`, wyniki czarne, bez `PORTA Steel EI 60 Plus`.

Dodatkowo sprawdź, że przekrój, który po Tasku 2 przestał być pusty, faktycznie zwraca wyniki bez komunikatu:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"biale drzwi rustykalne\",\"style\":\"rustykalny\"}" | tail -2
```
Expected: `styleCounts` z `"rustykalny":9`, brak `notice` o stylu, w wynikach warianty „Dąb Biały" (VECTOR, OSLO, LOFT 7.1, RESIST).

- [ ] **Step 4: Ten sam model w różnych kolorach zachowuje styl**

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"ciemne drzwi rustykalne\",\"style\":\"rustykalny\"}" | tail -2
```
Expected: wyniki rustykalne w ciemnych wybarwieniach — model rustykalny nie znika przez zmianę koloru (to była istota zgłoszenia).

- [ ] **Step 5: Pełna regresja**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: wszystkie testy zielone (134 + ~18 nowych), `tsc` bez wyjścia.

Run: `cd frontend && npx vitest run && npm run build`
Expected: testy zielone (33 + 9), build zielony.

Run: `curl -s http://localhost:3001/api/health; echo ""`
Expected: `{"status":"ok","services":{...:true}}`.

- [ ] **Step 6: Kontrola wzrokowa w UI**

Otwórz http://localhost:5173, wyszukaj ze zdjęcia jasnego wnętrza, sprawdź:
- rząd „Styl" pokazuje liczby przy każdym chipie,
- chip bez trafień jest przygaszony i nieklikalny (kursor `not-allowed`, tooltip „brak przy obecnych filtrach"),
- kliknięcie chipa z liczbą zwraca wyniki tego stylu,
- odkliknięcie aktywnego chipa działa nawet gdy jego licznik to 0.

- [ ] **Step 7: Commit końcowy (jeśli weryfikacja wymusiła poprawki)**

```bash
git add -A
git commit -m "test(style): weryfikacja e2e stylu per model"
```

---

## Self-Review

**Pokrycie specyfikacji:**

| Wymaganie specyfikacji | Task |
|---|---|
| `aggregateStyles` — większość, inaczej lider | 1 |
| Flagi identyczne dla wszystkich wariantów modelu | 2 (backfill), 4 (import) |
| `styleResolver` wpięty w import z UI i sync | 4 |
| `styleIndex` + `countStyles` + unieważnianie | 3 (indeks), 4 (unieważnianie) |
| `styleCounts` w `/search` i `/search-text` | 5 |
| Pominięcie pustego filtra stylu + `notice` | 5 |
| Komunikat łączony z `droppedFinish` | 5 |
| `ChipButton` wyciągnięty z duplikatu JSX | 6 |
| Liczby na chipach + wygaszanie zera | 6 |
| Brak `styleCounts` → zachowanie jak dziś | 6 (test „brak liczników") |
| Definicja ukończenia (e2e + regresja) | 7 |

**Odstępstwo od specyfikacji:** treść komunikatu o pominiętym stylu nie nazywa koloru („W białych nie ma…"), bo `filters.colors` bywa listą kilku rodzin — uzasadnienie w nagłówku Taska 5. Spec wymaga aktualizacji tego jednego zdania.

**Spójność nazw:** `aggregateStyles` (Task 1) używana w Task 2 i przez `stylesForModel` (Task 4); `countStylesIn`/`countStyles`/`invalidateStyleIndex` (Task 3) wołane w Task 4 i 5; `buildNotice` (Task 5) konsumuje klucze `droppedFinish`/`droppedStyle`; `liczbaChipa`/`chipWygaszony` (Task 6) czytają `styleCounts` z Taska 5. `modelOf` bez duplikatu — importowany z `glassResolver`.
