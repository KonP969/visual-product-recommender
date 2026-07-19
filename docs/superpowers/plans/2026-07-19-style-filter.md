# Filtr stylu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twardy filtr po 7 stylach (metka-zbiór z opisu EN), z zabezpieczeniem dla bezstylowych, chipem wysyłającym styl wprost i backfillem istniejącego katalogu.

**Architecture:** Klasyfikacja multi-label z opisu EN (bez wizji) → 8 flag boolean w Chromie → `buildWhere` z `$or` (styl + bezstylowe) → deterministyczny guard dla tekstu, jawne pole dla chipa. Frontend: 7 chipów stylu w osobnym rzędzie „Styl".

**Tech Stack:** Node/Express/TS + ChromaDB backend; React/TS/Vite frontend; vitest.

## Global Constraints

- 7 stylów (enum, w tej kolejności): `klasyczny, nowoczesny, minimalistyczny, rustykalny, loft, skandynawski, glamour`.
- Metka-zbiór (multi-label): drzwi mają WSZYSTKIE style potwierdzone opisem.
- Twardy filtr z zabezpieczeniem: filtr stylu X → drzwi z tym stylem PLUS bezstylowe (`style_none`). Bezstylowych NIGDY nie chowamy.
- Klasyfikacja z opisu EN (`description`), bez wizji, bez Gemini.
- Słowa-sygnały (zwalidowane, dokładnie te):
  - klasyczny: `/\bclassic|traditional|raised[ -]?panel/i`
  - nowoczesny: `/\bmodern|contemporary/i`
  - minimalistyczny: `/minimalist/i`
  - rustykalny: `/rustic|farmhouse|knotty/i`
  - loft: `/\bloft|industrial/i`
  - skandynawski: `/scandinav|nordic/i`
  - glamour: `/glamou?r|luxur|ornate|baroque|ozdobn/i`
- Chip wysyła styl WPROST (jawne pole w `/search-text`), tekst → guard `explicitStyleFromQuery` + LLM.
- Zmiana koloru/szkła w `classifyDoor` — ZERO. Tylko dokładamy `styles`.
- Node ia32; NIE ubijać procesów o zajęty port. Chroma `CHROMA_URL` (domyślnie localhost:8000).
- Frontend `verbatimModuleSyntax` → importy typów jako `import type`.

---

### Task 1: Klasyfikator stylu + flagi + tests (attributeService)

**Files:**
- Modify: `backend/src/services/attributeService.ts`
- Modify: `backend/src/services/__tests__/attributeService.test.ts`

**Interfaces:**
- Produces: `STYLES`, `Style`, `classifyStyles(description): Style[]`, `styleFlags(styles): Record<string, boolean>`, `explicitStyleFromQuery(query): Style | null`; `DoorAttributes.styles: Style[]`.

- [ ] **Step 1: Testy (mają paść)**

Dopisz do `backend/src/services/__tests__/attributeService.test.ts` (nowe importy + bloki):

```ts
import {
  classifyStyles,
  styleFlags,
  explicitStyleFromQuery,
  STYLES,
} from '../attributeService'

describe('classifyStyles — multi-label z opisu', () => {
  it('modern minimalist → [nowoczesny, minimalistyczny]', () => {
    expect(classifyStyles('white modern minimalist flat panel door')).toEqual(
      ['nowoczesny', 'minimalistyczny'],
    )
  })
  it('classic raised panel → [klasyczny]', () => {
    expect(classifyStyles('warm oak classic raised panel residential door')).toEqual(['klasyczny'])
  })
  it('loft/industrial → [loft]', () => {
    expect(classifyStyles('black industrial loft steel door')).toContain('loft')
  })
  it('brak sygnału → [] (unknown)', () => {
    expect(classifyStyles('a door for a room')).toEqual([])
  })
  it('kolejność wyniku zgodna z STYLES', () => {
    // "scandinavian classic" → klasyczny przed skandynawski (kolejność STYLES)
    const r = classifyStyles('scandinavian classic door')
    expect(r).toEqual(['klasyczny', 'skandynawski'])
  })
})

describe('styleFlags', () => {
  it('ustawia flagi obecnych stylów + style_none=false', () => {
    const f = styleFlags(['klasyczny', 'loft'])
    expect(f.style_klasyczny).toBe(true)
    expect(f.style_loft).toBe(true)
    expect(f.style_nowoczesny).toBe(false)
    expect(f.style_none).toBe(false)
  })
  it('pusty zbiór → style_none=true, reszta false', () => {
    const f = styleFlags([])
    expect(f.style_none).toBe(true)
    expect(STYLES.every((s) => f['style_' + s] === false)).toBe(true)
  })
})

describe('explicitStyleFromQuery', () => {
  it.each([
    ['drzwi klasyczne', 'klasyczny'],
    ['loftowe drzwi', 'loft'],
    ['nowoczesne drzwi', 'nowoczesny'],
    ['drzwi w stylu skandynawskim', 'skandynawski'],
    ['rustykalne drzwi', 'rustykalny'],
  ])('%s → %s', (q, expected) => {
    expect(explicitStyleFromQuery(q)).toBe(expected)
  })
  it.each([
    'nowoczesne albo klasyczne', // dwa style → null
    'jasne drewniane drzwi', // brak stylu
  ])('%s → null', (q) => {
    expect(explicitStyleFromQuery(q)).toBeNull()
  })
})
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `cd backend && npx vitest run src/services/__tests__/attributeService.test.ts`
Expected: FAIL — `classifyStyles` / `styleFlags` / `explicitStyleFromQuery` / `STYLES` nie istnieją.

- [ ] **Step 3: Zaimplementuj w `attributeService.ts`**

(a) Dodaj (np. po bloku `LIGHTNESS`/`GLASS_RE`, przed VARIANT_RULES):
```ts
export const STYLES = [
  'klasyczny',
  'nowoczesny',
  'minimalistyczny',
  'rustykalny',
  'loft',
  'skandynawski',
  'glamour',
] as const
export type Style = (typeof STYLES)[number]

// Styl czytamy z angielskiego opisu (już w metadanych) — nie z nazwy ani wizji.
// Multi-label: drzwi dostają KAŻDY styl, którego sygnał pojawia się w opisie,
// więc nie zmuszamy ich do jednego arbitralnego kubełka (mniejsze ryzyko przy
// twardym filtrze). Słowa-nastroje ("elegant") i konstrukcja ("flat panel")
// świadomie POMINIĘTE — to nie style.
const STYLE_SIGNALS: Array<[Style, RegExp]> = [
  ['klasyczny', /\bclassic|traditional|raised[ -]?panel/i],
  ['nowoczesny', /\bmodern|contemporary/i],
  ['minimalistyczny', /minimalist/i],
  ['rustykalny', /rustic|farmhouse|knotty/i],
  ['loft', /\bloft|industrial/i],
  ['skandynawski', /scandinav|nordic/i],
  ['glamour', /glamou?r|luxur|ornate|baroque|ozdobn/i],
]

export function classifyStyles(description: string): Style[] {
  return STYLE_SIGNALS.filter(([, re]) => re.test(description)).map(([s]) => s)
}

// Flagi boolean do metadanych Chromy (multi-label nie mieści się w skalarze).
// style_none = true, gdy opis nie dał żadnego stylu — te drzwi filtr stylu
// NIGDY nie odcina (zabezpieczenie: patrz buildWhere).
export function styleFlags(styles: Style[]): Record<string, boolean> {
  const flags: Record<string, boolean> = {}
  for (const s of STYLES) flags['style_' + s] = styles.includes(s)
  flags['style_none'] = styles.length === 0
  return flags
}

// Jawnie nazwany POJEDYNCZY styl w tekście → enum. Zero lub wiele → null
// (wtedy ufamy LLM-owi). Bliźniak explicitColorFromQuery.
const EXPLICIT_STYLE_TERMS: Array<[RegExp, Style]> = [
  [/klasyczn|\bclassic/i, 'klasyczny'],
  [/nowoczesn|\bmodern\w*/i, 'nowoczesny'],
  [/minimalist/i, 'minimalistyczny'],
  [/rustykaln|rustic/i, 'rustykalny'],
  [/\bloft\w*|industrial/i, 'loft'],
  [/skandynawsk|scandinav|nordyck/i, 'skandynawski'],
  [/glamou?r|glamur/i, 'glamour'],
]

export function explicitStyleFromQuery(query: string): Style | null {
  const found = new Set<Style>()
  for (const [re, s] of EXPLICIT_STYLE_TERMS) if (re.test(query)) found.add(s)
  return found.size === 1 ? [...found][0] : null
}
```

(b) Rozszerz `DoorAttributes`:
```ts
export interface DoorAttributes {
  colorFamily: ColorFamily | 'unknown'
  hasGlass: boolean
  /** 1 = najciemniejsze (czerń), 5 = najjaśniejsze (biel) */
  lightness: number
  styles: Style[]
}
```

(c) W `classifyDoor`, przed `return`, policz style z opisu i dołóż do wyniku:
```ts
  const styles = classifyStyles(description)

  return {
    colorFamily: colorFamily ?? 'unknown',
    hasGlass,
    lightness: colorFamily ? LIGHTNESS[colorFamily] : 3,
    styles,
  }
```

- [ ] **Step 4: Uruchom — mają przejść**

Run: `cd backend && npx vitest run src/services/__tests__/attributeService.test.ts`
Expected: PASS (nowe bloki + dotychczasowe classifyDoor).

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: czysto. (Uwaga: `classifyDoor` zwraca teraz `styles` — jeśli gdzieś destrukturyzowany bez tego pola, TS nie krzyknie, bo to dodanie pola. Ale sprawdź, że wszystkie użycia `DoorAttributes` się kompilują.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/attributeService.ts backend/src/services/__tests__/attributeService.test.ts
git commit -m "feat(style): klasyfikator multi-label + flagi + guard stylu"
```

---

### Task 2: Twardy filtr w Chromie (buildWhere + metadata) + tests

**Files:**
- Modify: `backend/src/services/chromaService.ts`
- Modify: `backend/src/services/__tests__/chromaService.test.ts`

**Interfaces:**
- Consumes: `Style` z attributeService.
- Produces: `HardFilters.style?: Style | null`; `ProductMetadata` + 8 pól `style_*`; `buildWhere` obsługuje styl.

- [ ] **Step 1: Test (ma paść)**

Dopisz do `backend/src/services/__tests__/chromaService.test.ts`:

```ts
describe('buildWhere — filtr stylu z zabezpieczeniem', () => {
  it('styl → $or (styl LUB bezstylowe)', () => {
    const where = buildWhere({ style: 'klasyczny' }) as { $and?: unknown[] }
    // przy samym stylu: pojedynczy warunek NIE jest owijany w $and, chyba że jest też category
    const cond = JSON.stringify(where)
    expect(cond).toContain('style_klasyczny')
    expect(cond).toContain('style_none')
  })

  it('styl łączy się z kolorem przez $and', () => {
    const where = buildWhere({ colors: ['black'], style: 'loft' }) as { $and: unknown[] }
    expect(where.$and).toContainEqual({ color_family: { $in: ['black'] } })
    expect(where.$and).toContainEqual({
      $or: [{ style_loft: true }, { style_none: true }],
    })
  })

  it('brak stylu → brak warunku stylu', () => {
    expect(JSON.stringify(buildWhere({ colors: ['white'] }))).not.toContain('style_')
  })
})
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `cd backend && npx vitest run src/services/__tests__/chromaService.test.ts`
Expected: FAIL — `style` nie istnieje w `HardFilters` (błąd typu) lub brak `style_` w wyniku.

- [ ] **Step 3: Zaimplementuj w `chromaService.ts`**

(a) Import typu na górze (dodaj do istniejącego importu z attributeService lub nowy):
```ts
import type { Style } from './attributeService'
```
> Jeśli chromaService nie importuje jeszcze z attributeService, dodaj osobną linię `import type { Style } from './attributeService'`. (verbatimModuleSyntax nie dotyczy backendu, ale trzymaj spójność — sprawdź tsconfig; jeśli backend nie ma verbatim, zwykły import też przejdzie.)

(b) Rozszerz `ProductMetadata` o 8 pól (opcjonalne):
```ts
export interface ProductMetadata {
  name: string
  price: string
  imageUrl: string
  productUrl?: string
  description?: string
  category?: 'residential' | 'specialty'
  currency?: string
  color_family?: string
  has_glass?: boolean
  lightness?: number
  style_klasyczny?: boolean
  style_nowoczesny?: boolean
  style_minimalistyczny?: boolean
  style_rustykalny?: boolean
  style_loft?: boolean
  style_skandynawski?: boolean
  style_glamour?: boolean
  style_none?: boolean
}
```

(c) Rozszerz `HardFilters`:
```ts
export interface HardFilters {
  colors?: string[] | null
  glass?: boolean | null
  style?: Style | null
}
```

(d) W `buildWhere`, po bloku `glass`, przed `return`:
```ts
  if (filters?.style) {
    // Styl LUB bezstylowe — bezstylowych (ubogi opis) nigdy nie chowamy.
    conditions.push({ $or: [{ ['style_' + filters.style]: true }, { style_none: true }] })
  }
```

- [ ] **Step 4: Uruchom — mają przejść**

Run: `cd backend && npx vitest run src/services/__tests__/chromaService.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: czysto.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chromaService.ts backend/src/services/__tests__/chromaService.test.ts
git commit -m "feat(style): twardy filtr stylu w buildWhere + pola metadanych"
```

---

### Task 3: LLM emituje styl + parse + ścieżka /search-text

**Files:**
- Modify: `backend/src/services/geminiService.ts`
- Modify: `backend/src/routes/search.ts`
- Modify: `backend/src/services/__tests__/attributeService.test.ts` (test parseDoorDescription — jest tam już)

**Interfaces:**
- Consumes: `Style`, `STYLES`, `explicitStyleFromQuery` z attributeService.
- Produces: `SearchFilters.style: Style | null`; `/search-text` przyjmuje `style` w body.

- [ ] **Step 1: Test parseDoorDescription ze stylem (ma paść)**

W `backend/src/services/__tests__/attributeService.test.ts`, w istniejącym bloku `describe('parseDoorDescription — filters')`, dodaj:

```ts
  it('parsuje style z listy STYLES, odrzuca spoza', () => {
    const ok = JSON.stringify({ clip_query: 'x', filters: { style: 'loft' } })
    expect(parseDoorDescription(ok).filters.style).toBe('loft')
    const bad = JSON.stringify({ clip_query: 'x', filters: { style: 'brutalist' } })
    expect(parseDoorDescription(bad).filters.style).toBeNull()
    const none = JSON.stringify({ clip_query: 'x', filters: {} })
    expect(parseDoorDescription(none).filters.style).toBeNull()
  })
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `cd backend && npx vitest run src/services/__tests__/attributeService.test.ts`
Expected: FAIL — `filters.style` undefined (nie ma pola).

- [ ] **Step 3: `geminiService.ts` — SearchFilters, parse, prompt, wersja**

(a) Import: dodaj `STYLES`, `Style` do istniejącego importu z attributeService:
```ts
import { COLOR_FAMILIES, ColorFamily, STYLES, Style, reasonConflictsWithColor } from './attributeService'
```

(b) `SearchFilters`:
```ts
export interface SearchFilters {
  colors: ColorFamily[] | null
  glass: boolean | null
  style: Style | null
}
```

(c) `parseFilters` — dodaj styl i uwzględnij w `empty`:
```ts
function parseFilters(raw: unknown): SearchFilters {
  const empty: SearchFilters = { colors: null, glass: null, style: null }
  if (!raw || typeof raw !== 'object') return empty
  const f = raw as { colors?: unknown; glass?: unknown; style?: unknown }

  let colors: ColorFamily[] | null = null
  if (Array.isArray(f.colors)) {
    const valid = f.colors.filter((c): c is ColorFamily =>
      COLOR_FAMILIES.includes(c as ColorFamily),
    )
    colors = valid.length > 0 ? valid : null
  }
  const glass = typeof f.glass === 'boolean' ? f.glass : null
  const style = STYLES.includes(f.style as Style) ? (f.style as Style) : null
  return { colors, glass, style }
}
```

(d) `FILTERS_RULES` — dopisz regułę stylu (przed zamykającym backtickiem stringa `FILTERS_RULES`):
```
- "style": ONE of ["klasyczny","nowoczesny","minimalistyczny","rustykalny","loft","skandynawski","glamour"] when the customer explicitly names a style, else null. "klasyczne"/"classic" → "klasyczny"; "nowoczesne"/"modern" → "nowoczesny"; "loftowe"/"industrial" → "loft"; "rustykalne" → "rustykalny"; "minimalistyczne" → "minimalistyczny"; "skandynawskie" → "skandynawski"; "glamour"/"eleganckie" → "glamour". A finish or panel shape alone (e.g. "flat panel") is NOT a style constraint — leave style null unless the customer names the style.
```

(e) Zaktualizuj dwa opisy schematu `"filters"` w promptach, żeby wymieniały styl. Znajdź obie linie:
```
- "filters": {"colors": [...] or null, "glass": true/false/null} — derived STRICTLY from the customer's constraints
```
i
```
- "filters": {"colors": [...], "glass": null} — 1-2 color families for the safe pick
```
zamień odpowiednio na warianty z `"style": ... or null` dopisanym w obiekcie (dodaj `, "style": <one of the 7 or null>`).

(f) Bump `PROMPT_VERSION` (unieważnia stare cache bez stylu):
```ts
const PROMPT_VERSION = 'v5-style'
```

- [ ] **Step 4: `search.ts` — /search-text przyjmuje jawny styl + guard**

W `backend/src/routes/search.ts`:

(a) Import: dodaj `explicitStyleFromQuery`:
```ts
import { explicitColorFromQuery, explicitStyleFromQuery } from '../services/attributeService'
```

(b) W handlerze `/search-text`, po odczycie `query`, odczytaj opcjonalny `style` z body i zastosuj. Znajdź istniejący blok guardu koloru:
```ts
    const explicitColors = explicitColorFromQuery(query)
    if (explicitColors) {
      description.filters = { ...description.filters, colors: explicitColors }
      console.log(`[SEARCH-TEXT] Guard: wymuszono kolor ${JSON.stringify(explicitColors)}`)
    }
```
i tuż po nim dodaj guard stylu (jawne pole z chipa PRZEBIJA tekst; brak → guard z tekstu):
```ts
    const bodyStyle = typeof req.body?.style === 'string' ? req.body.style : null
    const style = bodyStyle ?? explicitStyleFromQuery(query)
    if (style) {
      description.filters = { ...description.filters, style: style as any }
      console.log(`[SEARCH-TEXT] Guard: wymuszono styl ${style}`)
    }
```
> `bodyStyle` z chipa jest już poprawnym enumem (frontend wysyła tylko z listy). `parseFilters`/`buildWhere` i tak są tolerancyjne: nieznany styl → `buildWhere` doda warunek `style_<x>`, którego nikt nie ma → tylko bezstylowe; ale frontend nie wyśle śmiecia. Dla pewności można zawęzić do `STYLES`, ale nie jest to wymagane.

- [ ] **Step 5: Uruchom testy + typecheck**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: wszystkie PASS; typecheck czysto.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/geminiService.ts backend/src/routes/search.ts backend/src/services/__tests__/attributeService.test.ts
git commit -m "feat(style): LLM emituje styl, /search-text przyjmuje jawny styl z chipa"
```

---

### Task 4: Backfill katalogu + wpięcie w import + e2e backend

**Files:**
- Create: `backend/src/scripts/backfillStyle.ts`
- Modify: `backend/src/scripts/syncCatalog.ts`
- Modify: `backend/src/services/importService.ts`

**Interfaces:**
- Consumes: `classifyStyles`, `styleFlags` z attributeService.

- [ ] **Step 1: `backfillStyle.ts` — przeklasyfikuj istniejący katalog**

Create `backend/src/scripts/backfillStyle.ts`:

```ts
// Nadaje flagi style_* wszystkim residential z ich OPISU (już w metadanych).
// Metadane-only: bez embeddingu, bez Gemini, bez wizji — jeden przelot.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/backfillStyle.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { classifyStyles, styleFlags } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  const byStyle: Record<string, number> = {}
  let scanned = 0
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = (r.metadatas[i] ?? {}) as Record<string, unknown>
      scanned++
      if (categorizeDoor(String(m.name ?? '')) !== 'residential') return
      const styles = classifyStyles(String(m.description ?? ''))
      const flags = styleFlags(styles)
      ids.push(id)
      metas.push({ ...m, ...flags })
      const key = styles.length ? styles.join('+') : '(none)'
      byStyle[key] = (byStyle[key] ?? 0) + 1
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[STYLE] Przeskanowano ${scanned}, do aktualizacji ${ids.length}`)
  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
    console.log(`[STYLE] zaktualizowano ${Math.min(i + 200, ids.length)}/${ids.length}`)
  }
  // Raport: rozkład kombinacji stylów
  console.log('[STYLE] Rozkład (kombinacja → liczba):')
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

- [ ] **Step 2: Wepnij flagi w `syncCatalog.ts`**

W `backend/src/scripts/syncCatalog.ts`, import — dodaj `styleFlags`:
```ts
import { classifyDoor, styleFlags } from '../services/attributeService'
```
> `classifyDoor` już jest importowany — dodaj tylko `styleFlags` do tej samej linii (`import { classifyDoor } from '../services/attributeService'` → `import { classifyDoor, styleFlags } from '../services/attributeService'`).

W bloku budowania `metadatas.push({...})` (krok 3), dołóż flagi stylu (attrs ma już `styles`):
```ts
        metadatas.push({
          name: p.name,
          price: p.price,
          imageUrl: p.imageUrl,
          productUrl: p.productUrl,
          description: desc,
          category: categorizeDoor(p.name),
          currency: 'PLN',
          color_family: attrs.colorFamily,
          has_glass: attrs.hasGlass,
          lightness: attrs.lightness,
          ...styleFlags(attrs.styles),
        })
```

- [ ] **Step 3: Wepnij flagi w `importService.ts`**

W `backend/src/services/importService.ts`, import — dodaj `styleFlags`:
```ts
import { classifyDoor, styleFlags } from './attributeService'
```
W `upsertProduct(...)` metadata dołóż `...styleFlags(attrs.styles)`:
```ts
        await upsertProduct(product.id, embedding, {
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          productUrl: product.productUrl,
          category: categorizeDoor(product.name),
          currency: 'PLN',
          color_family: attrs.colorFamily,
          has_glass: attrs.hasGlass,
          lightness: attrs.lightness,
          ...styleFlags(attrs.styles),
        })
```
> Uwaga: import z UI woła `classifyDoor(product.name)` BEZ opisu, więc `attrs.styles` będzie `[]` → `style_none: true`. To OK: takie drzwi są zawsze pokazywane (zabezpieczenie). Nie próbuj tu dorabiać opisu — ścieżka UI jest obrazowa. Zostaw komentarz o tym.

- [ ] **Step 4: Typecheck + uruchom backfill**

Run: `cd backend && npx tsc --noEmit` → czysto.
Upewnij się, że Chroma żyje (`curl -s http://localhost:8000/api/v2/heartbeat` → 200).
Run: `cd backend && npx ts-node --transpile-only src/scripts/backfillStyle.ts 2>&1 | tail -6`
Expected: `[STYLE] GOTOWE.` z liczbą zaktualizowanych ~8006.

- [ ] **Step 5: E2e backend — filtr stylu działa (curl)**

Backend musi żyć (`curl -s http://localhost:3001/api/health`). Sprawdź, że „klasyczne” zwraca klasyczne+bezstylowe, a nie czysto-nowoczesne:
```bash
cd "C:/Users/Konrad/Documents/__projects_and_git_repo_clones/Procuct_reco_base_on_img"
for q in "drzwi klasyczne" "loftowe drzwi"; do
  echo "=== $q ==="
  curl -s -X POST http://localhost:3001/api/search-text -H "Content-Type: application/json" -d "{\"query\":\"$q\"}" \
   | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const l of d.trim().split('\n')){const e=JSON.parse(l);if(e.type==='result'){console.log('n=',e.data.products.length);console.log(e.data.products.slice(0,5).map(p=>' - '+p.name).join('\n'))}}})"
done
```
Expected: „drzwi klasyczne” → drzwi klasyczne (nazwy typu CLASSIC/raised panel) i/lub bezstylowe, brak oczywiście-nowoczesnych; „loftowe drzwi” → wąski, loftowy zestaw. Zapisz obserwację do raportu.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/backfillStyle.ts backend/src/scripts/syncCatalog.ts backend/src/services/importService.ts
git commit -m "feat(style): backfill stylu + flagi w ścieżce importu (sync + UI)"
```

---

### Task 5: Frontend — chipy stylu w rzędzie „Styl" + jawny styl do /search-text

**Files:**
- Modify: `frontend/src/lib/refinement.ts`
- Modify: `frontend/src/components/Rail.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/hooks/useSearch.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/__tests__/refinement.test.ts`

**Interfaces:**
- Produces: `CHIPY` z 7 stylami (grupa `styl`); `STYLE_LABELS` mapa etykieta↔styl; `aktywnyStyl(stan): string | null`; `searchByText(query, opts?, handlers?)` z `opts.style`.

- [ ] **Step 1: Test (ma paść) — aktywnyStyl + CHIPY styli**

W `frontend/src/lib/__tests__/refinement.test.ts` dodaj:

```ts
import { CHIPY, aktywnyStyl, stanPoczątkowy, dodajKrok } from '../refinement'

describe('chipy stylu', () => {
  it('CHIPY ma 7 stylów w grupie styl', () => {
    const style = CHIPY.filter((c) => c.grupa === 'styl').map((c) => c.etykieta)
    expect(style).toEqual([
      'klasyczne', 'nowoczesne', 'minimalistyczne', 'rustykalne', 'loftowe', 'skandynawskie', 'glamour',
    ])
  })
  it('aktywnyStyl mapuje etykietę na enum backendu', () => {
    let s = dodajKrok(stanPoczątkowy('drzwi'), 'loftowe', 'styl')
    expect(aktywnyStyl(s)).toBe('loft')
    s = dodajKrok(stanPoczątkowy('drzwi'), 'klasyczne', 'styl')
    expect(aktywnyStyl(s)).toBe('klasyczny')
  })
  it('aktywnyStyl null gdy brak kroku stylu', () => {
    expect(aktywnyStyl(stanPoczątkowy('drzwi'))).toBeNull()
  })
})
```

- [ ] **Step 2: Uruchom — ma paść**

Run: `cd frontend && npx vitest run src/lib/__tests__/refinement.test.ts`
Expected: FAIL — `aktywnyStyl` nie istnieje / CHIPY ma tylko „klasyczne”.

- [ ] **Step 3: `refinement.ts` — dodaj style + mapę + aktywnyStyl**

(a) Zamień w `CHIPY` pojedynczy wpis `{ etykieta: 'klasyczne', grupa: 'styl' }` na pełną siódemkę (na końcu tablicy):
```ts
  { etykieta: 'klasyczne', grupa: 'styl' },
  { etykieta: 'nowoczesne', grupa: 'styl' },
  { etykieta: 'minimalistyczne', grupa: 'styl' },
  { etykieta: 'rustykalne', grupa: 'styl' },
  { etykieta: 'loftowe', grupa: 'styl' },
  { etykieta: 'skandynawskie', grupa: 'styl' },
  { etykieta: 'glamour', grupa: 'styl' },
```

(b) Dodaj mapę etykieta→enum backendu i selektor aktywnego stylu:
```ts
// Etykieta chipa (PL, przymiotnik) → enum stylu backendu (rzeczownik).
export const STYLE_LABELS: Record<string, string> = {
  klasyczne: 'klasyczny',
  nowoczesne: 'nowoczesny',
  minimalistyczne: 'minimalistyczny',
  rustykalne: 'rustykalny',
  loftowe: 'loft',
  skandynawskie: 'skandynawski',
  glamour: 'glamour',
}

// Aktywny styl (jeśli jest krok grupy 'styl') → enum backendu do wysłania wprost.
export function aktywnyStyl(stan: StanZapytania): string | null {
  const krok = stan.kroki.find((k) => k.grupa === 'styl')
  return krok ? (STYLE_LABELS[krok.etykieta] ?? null) : null
}
```

- [ ] **Step 4: Uruchom test refinement — ma przejść**

Run: `cd frontend && npx vitest run src/lib/__tests__/refinement.test.ts`
Expected: PASS.

- [ ] **Step 5: `api.ts` — searchByText przyjmuje styl**

W `frontend/src/lib/api.ts`, zmień sygnaturę `searchByText`, by przyjmowała opcje ze stylem i wysyłała je w body:
```ts
export async function searchByText(
  query: string,
  opts: { style?: string | null } = {},
  handlers: SearchStreamHandlers = {},
): Promise<ApiResponse<SearchResult>> {
  try {
    const response = await fetch(`${BASE_URL}/search-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, style: opts.style ?? null }),
    })
    return await consumeSearchStream(response, handlers)
  } catch {
    return { error: 'Błąd sieci. Czy backend jest uruchomiony?' }
  }
}
```

- [ ] **Step 6: `useSearch.ts` — refine przekazuje styl**

W `frontend/src/hooks/useSearch.ts`, zmień `refine`, by przyjmował opcjonalny styl i przekazywał do `searchByText`:
```ts
  const refine = useCallback(
    async (query: string, style?: string | null) => {
      setAppState('loading')
      setSearchStage('analyzing')
      setErrorMessage(null)

      const { searchByText } = await import('@/lib/api')
      const response = await searchByText(query, { style: style ?? null }, {
        onStage: setSearchStage,
        onResult: applyResult,
        onReasons: mergeReasons,
      })
      applyError(response)
    },
    [applyResult, applyError, mergeReasons],
  )
```
Zaktualizuj typ `refine` w `UseSearchReturn`:
```ts
  refine: (query: string, style?: string | null) => Promise<void>
```

- [ ] **Step 7: `App.tsx` — wyślij aktywny styl przy każdym doprecyzowaniu**

W `frontend/src/App.tsx`:
(a) Import: dodaj `aktywnyStyl`:
```ts
import { Grupa, aktywnyStyl } from '@/lib/refinement'
```
> Jeśli `Grupa` jest w `import type`, dołóż `aktywnyStyl` w osobnym zwykłym imporcie (to wartość): `import { aktywnyStyl } from '@/lib/refinement'` oraz `import type { Grupa } from '@/lib/refinement'`.

(b) Handlery refine muszą policzyć styl z NASTĘPNEGO stanu. Akcje hooka zwracają string zapytania, ale styl liczymy z `refinement.stan` po akcji. Najprościej: policzyć styl z aktualnego `refinement.stan` wewnątrz handlera PO wywołaniu akcji — ale stan Reacta jest async. Zamiast tego licz styl z tego, co akcja robi: chip stylu ustawia krok grupy 'styl'. Zmień handlery, by po akcji wyliczyć styl przez `aktywnyStyl` na świeżym stanie hooka. Ponieważ akcje mutują ref w hooku synchronicznie, dodaj do hooka getter — patrz Step 8. Handlery:
```ts
  const handleChip = (etykieta: string, grupa: Grupa) => {
    const q = refinement.chip(etykieta, grupa)
    refine(q, refinement.stylTeraz())
  }
  const handleText = (text: string) => {
    const q = refinement.tekst(text)
    refine(q, refinement.stylTeraz())
  }
  const handleRemove = (index: number) => {
    const q = refinement.usuń(index)
    refine(q, refinement.stylTeraz())
  }
  const handleUndo = () => {
    const q = refinement.cofnijKrok()
    refine(q, refinement.stylTeraz())
  }
```

- [ ] **Step 8: `useRefinement.ts` — dodaj `stylTeraz()` (świeży styl z ref)**

Ponieważ akcje aktualizują `ref.current` synchronicznie, dodaj getter zwracający styl z bieżącego ref (nie ze stanu Reacta, który jest opóźniony):
```ts
import { aktywnyStyl } from '@/lib/refinement'
```
oraz w zwracanym obiekcie hooka dołóż:
```ts
    stylTeraz: () => aktywnyStyl(ref.current),
```
i w typie `UseRefinementReturn`:
```ts
  stylTeraz: () => string | null
```

- [ ] **Step 9: `Rail.tsx` — osobny rząd „Styl"**

W `frontend/src/components/Rail.tsx`, rozdziel paletę: chipy grupy `styl` renderuj w osobnej, podpisanej sekcji pod dotychczasowymi. Znajdź blok renderujący `CHIPY.map(...)` i zamień na dwa bloki:

```tsx
      <div className="flex flex-wrap gap-2" role="group" aria-label="Doprecyzuj wyszukiwanie">
        {CHIPY.filter((c) => c.grupa !== 'styl').map((chip) => {
          const aktywny = czyAktywny(stan, chip.etykieta, chip.grupa)
          return (
            <button
              key={chip.etykieta}
              type="button"
              disabled={busy}
              aria-pressed={aktywny}
              onClick={() => onChip(chip.etykieta, chip.grupa)}
              className={
                aktywny
                  ? 'rounded-full border border-brass bg-brass px-3.5 py-1.5 text-[13px] font-medium text-paper transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
                  : 'rounded-full border border-linen bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brass hover:bg-brass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
              }
            >
              {chip.etykieta}
            </button>
          )
        })}
      </div>

      <div role="group" aria-label="Styl">
        <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft">Styl</p>
        <div className="flex flex-wrap gap-2">
          {CHIPY.filter((c) => c.grupa === 'styl').map((chip) => {
            const aktywny = czyAktywny(stan, chip.etykieta, chip.grupa)
            return (
              <button
                key={chip.etykieta}
                type="button"
                disabled={busy}
                aria-pressed={aktywny}
                onClick={() => onChip(chip.etykieta, chip.grupa)}
                className={
                  aktywny
                    ? 'rounded-full border border-brass bg-brass px-3.5 py-1.5 text-[13px] font-medium text-paper transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
                    : 'rounded-full border border-linen bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brass hover:bg-brass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
                }
              >
                {chip.etykieta}
              </button>
            )
          })}
        </div>
      </div>
```

- [ ] **Step 10: Typecheck + testy + build**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run && npm run build`
Expected: tsc czysto (pamiętaj `import type` dla typów), vitest PASS, build zielony.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/refinement.ts frontend/src/components/Rail.tsx frontend/src/lib/api.ts frontend/src/hooks/useSearch.ts frontend/src/hooks/useRefinement.ts frontend/src/App.tsx frontend/src/lib/__tests__/refinement.test.ts
git commit -m "feat(style): 7 chipów stylu w rzędzie Styl, chip wysyła styl wprost"
```

---

## Definicja ukończenia

- Testy jednostkowe (backend attributeService/chromaService, frontend refinement) zielone; backend vitest 90+ i front vitest 18+ PASS; typecheck backend i front czyste; `npm run build` zielony.
- Backfill nadał flagi `style_*` (~8006 rekordów).
- E2e backend (curl): „drzwi klasyczne” → klasyczne+bezstylowe bez czysto-nowoczesnych; „loftowe drzwi” ostro zawęża.
- E2e frontend (kontroler, przeglądarka): rząd „Styl" z 7 chipami; klik „klasyczne" filtruje; klik „loftowe" wypiera „klasyczne" i zawęża; blockquote/żetony działają jak dotąd.
- Punkt powrotu: `master` @ cdc7230.
