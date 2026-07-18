# Wizyjne wykrywanie szkła w imporcie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nowo importowane produkty (sync z feedu i import z UI) dostają poprawne `has_glass` dzięki wizyjnemu rozstrzyganiu szkła na końcu importu — bez regresji do klasyfikacji tekstowej.

**Architecture:** Wspólny moduł `glassResolver.ts` z czystymi helperami (`modelOf`, `decideGlassFromName`) + orkiestracją `resolveGlassForProducts`. Wołany na końcu `syncCatalog` i importu z UI, tylko na nowo dodanych produktach. Szkło = cecha modelu: reguła z nazwy → reuse z Chromy → wizja (1 na model). `backfillGlass.ts` przełączony na te same helpery.

**Tech Stack:** Node + TypeScript + ChromaDB + Gemini vision (`classifyGlassFromImage`) + vitest.

## Global Constraints

- Zmiana **wyłącznie w backendzie** (`backend/`). Front nietknięty.
- `classifyDoor` BEZ zmian — tekstowy `has_glass` zostaje jako pierwszy zapis + fallback.
- Wyłącznie `has_glass` — nie ruszać koloru/opisu/lightness.
- Chroma pod `CHROMA_URL` (domyślnie `http://localhost:8000`), kolekcja `products`.
- Wizja przez `classifyGlassFromImage(buffer, mimetype)` z `geminiService` (zwraca `boolean | null`).
- Współbieżność wizji: **3**.
- Reuse dla istniejących modeli opiera się na Chromie (jeden odczyt `(name, has_glass)`), NIE na `backfill_glass_progress.json`.
- Pad wizji → brak korekty → zostaje wartość tekstowa (import nigdy się nie wysypuje ani nie zostawia `null`).
- Node ia32. NIE ubijać procesów o zajęty port.
- Reguły z nazwy: `GLASS_RE` i `SOLID_NAME_RE` z `attributeService` (już istnieją, eksportowane).

---

### Task 1: Moduł `glassResolver.ts` + testy jednostkowe czystej logiki

**Files:**
- Create: `backend/src/services/glassResolver.ts`
- Create: `backend/src/services/__tests__/glassResolver.test.ts`

**Interfaces:**
- Consumes: `GLASS_RE`, `SOLID_NAME_RE` z `attributeService`; `categorizeDoor` z `chromaService`; `classifyGlassFromImage` z `geminiService`.
- Produces:
  - `interface NowyProdukt { id: string; name: string; imageUrl: string }`
  - `interface WynikResolve { visionCalls: number; flips: number; failed: number }`
  - `modelOf(name: string): string`
  - `decideGlassFromName(names: string[]): boolean | null`
  - `visionDecision(imageUrl: string): Promise<boolean | null>`
  - `resolveGlassForProducts(nowe: NowyProdukt[]): Promise<WynikResolve>`

- [ ] **Step 1: Napisz testy jednostkowe (mają paść — moduł nie istnieje)**

Create `backend/src/services/__tests__/glassResolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { modelOf, decideGlassFromName } from '../glassResolver'

describe('modelOf', () => {
  it.each([
    ['PORTA CLASSIC HOME model C.2 - Szary', 'PORTA CLASSIC HOME model C.2'],
    ['PORTA VERTE HOME model H.1 z czarną szybą - Dąb Klasyczny', 'PORTA VERTE HOME model H.1 z czarną szybą'],
    ['PORTA UNI KOLOR MODERN model 1.1', 'PORTA UNI KOLOR MODERN model 1.1'], // brak wariantu
  ])('%s → %s', (name, expected) => {
    expect(modelOf(name)).toBe(expected)
  })
})

describe('decideGlassFromName — precedencja z nazw', () => {
  it('dowolny wariant z GLASS_RE → true', () => {
    expect(decideGlassFromName([
      'PORTA KONCEPT model A.3 z czarną szybą - Biały',
      'PORTA KONCEPT model A.3 z czarną szybą - Dąb',
    ])).toBe(true)
  })

  it('dowolny wariant z SOLID_NAME_RE (pełne) → false', () => {
    expect(decideGlassFromName(['PORTA VECTOR model pełne - Biały'])).toBe(false)
  })

  it('cichy model (brak słów o szkle w nazwie) → null', () => {
    expect(decideGlassFromName([
      'PORTA CLASSIC HOME model C.2 - Szary',
      'PORTA CLASSIC HOME model C.2 - Biały',
    ])).toBeNull()
  })

  it('glass wygrywa gdy jeden wariant ma szybę, inny nie', () => {
    expect(decideGlassFromName([
      'PORTA X model 1 - Biały',
      'PORTA X model 1 z szybą - Dąb',
    ])).toBe(true)
  })

  it('pusta lista → null', () => {
    expect(decideGlassFromName([])).toBeNull()
  })
})
```

- [ ] **Step 2: Uruchom testy — mają paść**

Run: `cd backend && npx vitest run src/services/__tests__/glassResolver.test.ts`
Expected: FAIL — `Cannot find module '../glassResolver'`.

- [ ] **Step 3: Zaimplementuj `glassResolver.ts`**

Create `backend/src/services/glassResolver.ts`:

```ts
// Wizyjne rozstrzyganie has_glass dla NOWO dodanych produktów — wołane na końcu
// syncCatalog i importu z UI. Szkło = cecha MODELU, nie koloru: 1 decyzja na
// model propagowana na warianty. Import zapisuje has_glass tekstowo (classifyDoor);
// ta funkcja tylko KORYGUJE tam, gdzie nazwa/reuse/wizja dają pewniejszą odpowiedź.
// Pad wizji → brak korekty → zostaje wartość tekstowa (import się nie wysypie).
import axios from 'axios'
import { ChromaClient } from 'chromadb'
import { GLASS_RE, SOLID_NAME_RE } from './attributeService'
import { categorizeDoor } from './chromaService'
import { classifyGlassFromImage } from './geminiService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const CONCURRENCY = 3

export interface NowyProdukt {
  id: string
  name: string
  imageUrl: string
}

export interface WynikResolve {
  visionCalls: number
  flips: number
  failed: number
}

export function modelOf(name: string): string {
  return name.split(' - ')[0].trim()
}

// Decyzja o szkle wyłącznie z NAZW wariantów modelu.
// null = "cichy" model — nazwa nie rozstrzyga (trzeba reuse lub wizji).
export function decideGlassFromName(names: string[]): boolean | null {
  if (names.some((n) => GLASS_RE.test(n))) return true
  if (names.some((n) => SOLID_NAME_RE.test(n))) return false
  return null
}

// Pobiera obraz i pyta model wizyjny. Zwraca null przy niepewności/błędzie.
export async function visionDecision(imageUrl: string): Promise<boolean | null> {
  const res = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: { 'User-Agent': 'VisualProductRecommender/1.0' },
  })
  const buffer = Buffer.from(res.data)
  const ct = String(res.headers['content-type'] ?? '')
  const mimetype = ct.startsWith('image/')
    ? ct
    : imageUrl.toLowerCase().includes('.png')
      ? 'image/png'
      : 'image/jpeg'
  return classifyGlassFromImage(buffer, mimetype)
}

/**
 * Koryguje has_glass dla nowo dodanych produktów. Zakłada, że rekordy są już
 * w Chromie (import je zapisał z has_glass tekstowym). Grupuje po modelu,
 * rozstrzyga: nazwa → reuse z istniejących → wizja. Aktualizuje tylko różnice.
 */
export async function resolveGlassForProducts(nowe: NowyProdukt[]): Promise<WynikResolve> {
  const result: WynikResolve = { visionCalls: 0, flips: 0, failed: 0 }
  const residential = nowe.filter((p) => categorizeDoor(p.name) === 'residential')
  if (residential.length === 0) return result

  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // Jeden odczyt całej kolekcji: (a) mapa model→has_glass z ISTNIEJĄCYCH rekordów
  // (reuse — Chroma nie filtruje po prefiksie nazwy), (b) metadane NOWYCH rekordów
  // (potrzebne do update). newIds oddziela "istniejące rodzeństwo" od świeżo dodanych.
  const newIds = new Set(residential.map((p) => p.id))
  const existingByModel = new Map<string, boolean>()
  const newMeta = new Map<string, Record<string, unknown>>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = (r.metadatas[i] ?? {}) as Record<string, unknown>
      if (newIds.has(id)) {
        newMeta.set(id, m)
      } else {
        const model = modelOf(String(m.name ?? ''))
        if (!existingByModel.has(model) && typeof m.has_glass === 'boolean') {
          existingByModel.set(model, m.has_glass as boolean)
        }
      }
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  // Grupuj nowe po modelu
  const byModel = new Map<string, NowyProdukt[]>()
  for (const p of residential) {
    const key = modelOf(p.name)
    if (!byModel.has(key)) byModel.set(key, [])
    byModel.get(key)!.push(p)
  }

  // Rozstrzygnij decyzję per model: nazwa → reuse → (wizja później)
  const decisions = new Map<string, boolean>()
  const silent: string[] = []
  for (const [model, variants] of byModel) {
    const fromName = decideGlassFromName(variants.map((v) => v.name))
    if (fromName !== null) {
      decisions.set(model, fromName)
    } else if (existingByModel.has(model)) {
      decisions.set(model, existingByModel.get(model)!)
    } else {
      silent.push(model)
    }
  }

  // Wizja na cichych modelach (współbieżność CONCURRENCY)
  const queue = [...silent]
  async function worker() {
    while (queue.length > 0) {
      const model = queue.shift()!
      const variants = byModel.get(model)!
      const rep = variants.find((v) => v.imageUrl) ?? variants[0]
      try {
        const glass = await visionDecision(rep.imageUrl)
        result.visionCalls++
        if (glass === null) {
          result.failed++
          continue
        }
        decisions.set(model, glass)
      } catch {
        result.visionCalls++
        result.failed++
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // Zastosuj: update has_glass na nowych rekordach, gdzie różni się od decyzji.
  const updIds: string[] = []
  const updMetas: Record<string, unknown>[] = []
  for (const [model, variants] of byModel) {
    if (!decisions.has(model)) continue
    const glass = decisions.get(model)!
    for (const v of variants) {
      const meta = newMeta.get(v.id)
      if (meta && meta.has_glass !== glass) {
        updIds.push(v.id)
        updMetas.push({ ...meta, has_glass: glass })
        result.flips++
      }
    }
  }
  for (let i = 0; i < updIds.length; i += 200) {
    await col.update({ ids: updIds.slice(i, i + 200), metadatas: updMetas.slice(i, i + 200) as any })
  }

  return result
}
```

- [ ] **Step 4: Uruchom testy jednostkowe — mają przejść**

Run: `cd backend && npx vitest run src/services/__tests__/glassResolver.test.ts`
Expected: PASS (wszystkie describe zielone).

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: brak błędów.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/glassResolver.ts backend/src/services/__tests__/glassResolver.test.ts
git commit -m "feat(glass-sync): moduł glassResolver — wizyjne szkło dla nowych produktów"
```

---

### Task 2: Wpięcie w `syncCatalog` i `importService` + weryfikacja e2e

**Files:**
- Modify: `backend/src/scripts/syncCatalog.ts` (po pętli batchy — krok 3)
- Modify: `backend/src/services/importService.ts` (po pętli importu)
- Create (tymczasowy, usuwany na końcu): `backend/src/scripts/verifyGlassResolve.ts`

**Interfaces:**
- Consumes: `resolveGlassForProducts`, `NowyProdukt` z `glassResolver`.

- [ ] **Step 1: Wepnij w `syncCatalog.ts`**

W `backend/src/scripts/syncCatalog.ts`:

(a) Dodaj import (obok istniejących):
```ts
import { resolveGlassForProducts } from '../services/glassResolver'
```

(b) Zbieraj faktycznie dodane produkty. W pętli batchy jest `for (let i = 0; i < batch.length; i++)`, który buduje `ids/embeddings/metadatas`. Zadeklaruj PRZED pętlą batchy (obok `let indexed = 0`):
```ts
  const dodane: { id: string; name: string; imageUrl: string }[] = []
```
W środku, tuż po `ids.push(p.id)` (gdy produkt przechodzi), dopisz:
```ts
        dodane.push({ id: p.id, name: p.name, imageUrl: p.imageUrl })
```

(c) Po całej pętli batchy, PRZED `const finalCount = await col.count()`, dodaj:
```ts
  if (dodane.length > 0) {
    console.log(`[SYNC] Wizyjne szkło dla ${dodane.length} nowych…`)
    const glass = await resolveGlassForProducts(dodane)
    console.log(`[SYNC] Szkło: ${glass.flips} korekt, ${glass.visionCalls} wizji, ${glass.failed} nierozstrzygniętych`)
  }
```

- [ ] **Step 2: Wepnij w `importService.ts`**

W `backend/src/services/importService.ts`:

(a) Dodaj import:
```ts
import { resolveGlassForProducts } from './glassResolver'
```

(b) Zbieraj zaimportowane. Przed pętlą `for (let i = 0; i < products.length; i++)` (obok `let success = 0`):
```ts
  const dodane: { id: string; name: string; imageUrl: string }[] = []
```
Wewnątrz gałęzi sukcesu, tuż po `success++`, dopisz:
```ts
        dodane.push({ id: product.id, name: product.name, imageUrl: product.imageUrl })
```

(c) Po pętli `for`, PRZED `return` z podsumowaniem (znajdź `return { current: ..., total: ... }` lub końcowe zbudowanie wyniku — dodaj tuż przed nim):
```ts
  if (dodane.length > 0) {
    console.log(`[IMPORT] Wizyjne szkło dla ${dodane.length} nowych…`)
    try {
      const glass = await resolveGlassForProducts(dodane)
      console.log(`[IMPORT] Szkło: ${glass.flips} korekt, ${glass.visionCalls} wizji, ${glass.failed} nierozstrzygniętych`)
    } catch (err) {
      console.warn('[IMPORT] Wizyjne szkło padło (pomijam):', err instanceof Error ? err.message : err)
    }
  }
```
> Uwaga: znajdź dokładne miejsce `return` w `runImport` i wstaw blok tuż przed nim. Jeśli funkcja kończy się `return { success, skipped, failed, ... }` — blok idzie nad tym returnem. Import z UI nie może się wywalić z powodu szkła, stąd `try/catch`.

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: brak błędów.

- [ ] **Step 4: Napisz tymczasowy harness weryfikacyjny e2e**

Ten harness sprawdza DWIE rzeczy na ŻYWEJ Chromie, bez kosztu Gemini dla reuse:
(1) reuse: syntetyczny „nowy wariant" istniejącego modelu-ze-szkłem i modelu-pełnego → `has_glass` poprawne, `visionCalls === 0`;
(2) sprząta po sobie (usuwa syntetyczne id).

Create `backend/src/scripts/verifyGlassResolve.ts`:

```ts
// Tymczasowy harness: weryfikuje reuse w resolveGlassForProducts bez kosztu wizji.
// Bierze istniejący model ZE SZKŁEM i istniejący model PEŁNY, tworzy syntetyczny
// "nowy wariant" każdego (celowo z ODWROTNYM has_glass), uruchamia resolve i
// sprawdza, że reuse skorygował has_glass BEZ wywołania wizji. Sprząta po sobie.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/verifyGlassResolve.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { getTextEmbedding } from '../services/clipService'
import { resolveGlassForProducts, modelOf, decideGlassFromName } from '../services/glassResolver'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // Znajdź jeden istniejący model ze szkłem i jeden pełny — ale WYŁĄCZNIE CICHE
  // (decideGlassFromName === null), żeby test faktycznie ćwiczył REUSE, a nie
  // decyzję z nazwy. Gdyby model miał "szyba" w nazwie, resolve trafiłby przez
  // nazwę i visionCalls też byłoby 0 — ale wtedy nie testowalibyśmy reuse.
  const glassSample = new Map<string, any>()
  const solidSample = new Map<string, any>()
  let offset = 0
  while (glassSample.size === 0 || solidSample.size === 0) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = r.metadatas[i] as any
      if (m.category !== 'residential' || !m.name || !m.imageUrl) return
      if (decideGlassFromName([m.name]) !== null) return // nazwa rozstrzyga → nie testuje reuse
      if (m.has_glass === true && glassSample.size === 0) glassSample.set(id, m)
      if (m.has_glass === false && solidSample.size === 0) solidSample.set(id, m)
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  const [glassMeta] = [...glassSample.values()]
  const [solidMeta] = [...solidSample.values()]
  if (!glassMeta || !solidMeta) throw new Error('Brak próbek glass/solid w bazie')
  console.log(`[VERIFY] model ze szkłem: ${modelOf(glassMeta.name)}`)
  console.log(`[VERIFY] model pełny:     ${modelOf(solidMeta.name)}`)

  // Syntetyczne "nowe warianty": ta sama nazwa modelu, nowe id, ODWROTNE has_glass
  // (żeby korekta była widoczna jako flip). Embedding z opisu, żeby upsert przeszedł.
  const synth = [
    { id: `__verify_glass__`, base: glassMeta, expect: true },
    { id: `__verify_solid__`, base: solidMeta, expect: false },
  ]
  for (const s of synth) {
    const emb = await getTextEmbedding(String(s.base.description ?? s.base.name))
    await col.upsert({
      ids: [s.id],
      embeddings: [emb],
      metadatas: [{ ...s.base, has_glass: !s.expect }], // celowo odwrotne
    })
  }

  const nowe = synth.map((s) => ({ id: s.id, name: s.base.name, imageUrl: s.base.imageUrl }))
  const res = await resolveGlassForProducts(nowe)
  console.log(`[VERIFY] wynik: ${JSON.stringify(res)}`)

  // Sprawdź: has_glass skorygowane do oczekiwanego, i reuse = 0 wizji.
  const check = await col.get({ ids: synth.map((s) => s.id), include: ['metadatas'] as any })
  const got = new Map<string, any>()
  check.ids.forEach((id: string, i: number) => got.set(id, check.metadatas[i]))
  let ok = true
  for (const s of synth) {
    const actual = got.get(s.id)?.has_glass
    const pass = actual === s.expect
    ok = ok && pass
    console.log(`[VERIFY] ${s.id}: has_glass=${actual} oczekiwane=${s.expect} → ${pass ? 'OK' : 'BŁĄD'}`)
  }
  const reuseOk = res.visionCalls === 0
  console.log(`[VERIFY] visionCalls=${res.visionCalls} (reuse ${reuseOk ? 'OK — 0 wizji' : 'BŁĄD — spodziewano 0'})`)

  // Sprzątanie
  await col.delete({ ids: synth.map((s) => s.id) })
  console.log(`[VERIFY] posprzątano syntetyczne id.`)

  if (!ok || !reuseOk) {
    console.error('[VERIFY] NIEPOWODZENIE')
    process.exit(1)
  }
  console.log('[VERIFY] SUKCES — reuse koryguje has_glass bez wizji.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 5: Uruchom harness — musi zakończyć się SUKCESEM**

Najpierw upewnij się, że stos żyje: `curl -s http://localhost:3001/api/health` → `status:ok`.
Run: `cd backend && npx ts-node --transpile-only src/scripts/verifyGlassResolve.ts`
Expected: `[VERIFY] SUKCES` — oba `has_glass` skorygowane (`OK`), `visionCalls=0`, syntetyczne id usunięte.

- [ ] **Step 6: Spot-check wizji na 1 cichym modelu (opcjonalny, tani)**

Ten krok potwierdza ścieżkę wizji (nie tylko reuse). Jeśli w bazie jest już
`__verify` posprzątane — bezpiecznie. Napisz jednorazowo w harnessie LUB ręcznie:
weź reprezentatywny obraz znanego cichego modelu ze szkłem (np. `PORTA CLASSIC HOME model C.2`)
i wywołaj `visionDecision(url)` — oczekiwane `true`. Wykonaj przez szybki skrypt inline:
```bash
cd backend && npx ts-node --transpile-only -e "import('./src/services/glassResolver').then(async m => { const url=process.env.IMG; console.log(await m.visionDecision(url)) })"
```
gdzie `IMG` to URL packshotu cichego-szklanego modelu (pobierz z bazy ręcznie).
Expected: `true`. To potwierdza, że wizja żyje. (Jeśli nie masz pod ręką URL — pomiń; reuse + testy jednostkowe pokrywają logikę, a wizja to ten sam `classifyGlassFromImage` co w działającym backfillu.)

- [ ] **Step 7: Usuń harness i commit**

```bash
rm backend/src/scripts/verifyGlassResolve.ts
git add backend/src/scripts/syncCatalog.ts backend/src/services/importService.ts
git commit -m "feat(glass-sync): wpięcie resolveGlassForProducts w sync i import z UI"
```
> Harness był tymczasowy (weryfikacja e2e) — nie wchodzi do repo.

---

### Task 3: Refaktor `backfillGlass.ts` na wspólne helpery

**Files:**
- Modify: `backend/src/scripts/backfillGlass.ts`

**Interfaces:**
- Consumes: `modelOf`, `decideGlassFromName`, `visionDecision` z `glassResolver`.

- [ ] **Step 1: Przełącz `backfillGlass.ts` na helpery z `glassResolver`**

W `backend/src/scripts/backfillGlass.ts`:

(a) Usuń lokalne definicje `modelOf` (linia ~44) i `visionDecision` (linie ~60-74).
(b) Zmień importy: usuń `GLASS_RE, SOLID_NAME_RE` z importu `attributeService` JEŚLI nieużywane po zmianie (patrz niżej — użyjemy `decideGlassFromName` zamiast bezpośrednio regexów). Dodaj:
```ts
import { modelOf, decideGlassFromName, visionDecision } from '../services/glassResolver'
```
(c) W sekcji „podziel modele wg źródła decyzji" zastąp bezpośrednie użycie regexów `decideGlassFromName`. Obecny fragment:
```ts
    const anyGlassName = variants.some((v) => GLASS_RE.test(v.name))
    const anySolidName = variants.some((v) => SOLID_NAME_RE.test(v.name))
    if (anyGlassName) progress[model] = { glass: true, source: 'name-glass' }
    else if (anySolidName) progress[model] = { glass: false, source: 'name-solid' }
    else silentModels.push(model)
```
zastąp:
```ts
    const fromName = decideGlassFromName(variants.map((v) => v.name))
    if (fromName === true) progress[model] = { glass: true, source: 'name-glass' }
    else if (fromName === false) progress[model] = { glass: false, source: 'name-solid' }
    else silentModels.push(model)
```
(d) `GLASS_RE`/`SOLID_NAME_RE` nie są już używane bezpośrednio → usuń z importu `attributeService` (jeśli był to jedyny użytek — sprawdź plik; `categorizeDoor` zostaje).

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: brak błędów (brak nieużywanych importów).

- [ ] **Step 3: Sanity-run backfillu — musi być no-op (katalog już rozstrzygnięty)**

Katalog został już w pełni zbackfillowany (commit f10bd82), a plik postępu
`scripts/backfill_glass_progress.json` istnieje. Ponowny bieg powinien niczego
nie zmienić — to dowód, że refaktor nie zmienił zachowania.
Upewnij się, że Chroma żyje (`curl -s http://localhost:8000/api/v2/heartbeat` → 200).
Run: `cd backend && npx ts-node --transpile-only src/scripts/backfillGlass.ts 2>&1 | tail -6`
Expected: kończy się `[GLASS] GOTOWE. Zmieniono has_glass w 0 rekordach.` (0 zmian — refaktor zachowuje zachowanie). Jeśli >0 zmian — STOP, refaktor coś złamał, zbadaj.

- [ ] **Step 4: Pełny zestaw testów backendu (regresja)**

Run: `cd backend && npx vitest run 2>&1 | tail -6`
Expected: wszystkie PASS (82 dotychczasowe + 5 nowych z Task 1 = 87).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scripts/backfillGlass.ts
git commit -m "refactor(glass-sync): backfillGlass na wspólne helpery glassResolver"
```

---

## Definicja ukończenia

- Testy jednostkowe `glassResolver.test.ts` zielone; cały backend vitest (87) zielony.
- `tsc --noEmit` czysty.
- Harness e2e (Task 2) zakończył się SUKCESEM: reuse koryguje `has_glass` bez wizji (`visionCalls===0`), syntetyczne id posprzątane.
- `backfillGlass` po refaktorze: sanity-run = 0 zmian (zachowanie niezmienione).
- Front nietknięty, `classifyDoor` niezmieniony.
- Punkt powrotu: `master` @ 5ccb307.
