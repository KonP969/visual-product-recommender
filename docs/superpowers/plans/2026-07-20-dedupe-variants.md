# Zwijanie wariantów w wynikach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wyniki wyszukiwania zwijają rekordy o identycznej nazwie (model+kolor) do jednej karty „od {min} zł" z licznikiem wariantów — bez ruszania danych w Chromie.

**Architecture:** Czysta funkcja `dedupeByName` wpięta między ranking a MMR w `searchSimilar`; nowe pola `variantCount`/`priceFrom` na `SearchResultItem` przechodzą przez MMR (poprawka końcowego map) do payloadu i karty.

**Tech Stack:** Node/Express/TS + ChromaDB backend; React/TS/Vite frontend; vitest.

## Global Constraints

- Zwijanie po DOKŁADNEJ `metadata.name` (identyczny string). Różne nazwy (w tym „bezprzylgowe") NIE zwijają się.
- Reprezentant = PIERWSZY w posortowanym rankingu (najlepiej dopasowany). Kolejność wyniku = kolejność rankingu.
- `priceFrom` = string ceny NAJTAŃSZEGO wariantu w grupie (z puli kandydatów). `variantCount` = liczność grupy w puli.
- Singleton: `variantCount=1`, `priceFrom` = własna cena.
- Dane w Chromie NIETKNIĘTE (to tylko prezentacja). Zero migracji.
- `dedupeByName` typowana strukturalnie jak `applyMMR`: `Array<SearchResultItem & { embedding: number[] }>` (NIE prywatny CandidateItem).
- Frontend `verbatimModuleSyntax` → importy typów jako `import type`.
- Node ia32; NIE ubijać procesów.

---

### Task 1: `dedupeByName` + pola wyniku + wpięcie w pipeline + testy

**Files:**
- Modify: `backend/src/services/chromaService.ts`
- Modify: `backend/src/routes/search.ts`
- Modify: `backend/src/services/__tests__/chromaService.test.ts`

**Interfaces:**
- Produces: `dedupeByName(...)`; `SearchResultItem.variantCount?`, `SearchResultItem.priceFrom?`.

- [ ] **Step 1: Testy (mają paść)**

Dopisz do `backend/src/services/__tests__/chromaService.test.ts`. Uwaga: `candidate()` helper już istnieje w pliku (tworzy `SearchResultItem & { embedding }` z `metadata: { name: id, price: '100', imageUrl: '' }`). Dodaj import `dedupeByName` do istniejącego importu z `../chromaService` i nowy blok. Potrzebny jest wariant helpera z jawną nazwą i ceną — zdefiniuj lokalnie w bloku:

```ts
describe('dedupeByName — zwijanie po nazwie', () => {
  const item = (id: string, name: string, price: string, similarity: number) => ({
    id,
    similarity,
    embedding: [1, 0],
    metadata: { name, price, imageUrl: '' },
  })

  it('zwija identyczne nazwy do jednego (reprezentant = pierwszy)', () => {
    const out = dedupeByName([
      item('a', 'HIDE 1.1 - Biały', '798', 0.95),
      item('b', 'HIDE 1.1 - Biały', '540', 0.94),
      item('c', 'HIDE 1.1 - Biały', '1266', 0.93),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a') // najlepiej dopasowany
    expect(out[0].variantCount).toBe(3)
    expect(out[0].priceFrom).toBe('540') // najtańszy w grupie
  })

  it('różne nazwy zostają wszystkie', () => {
    const out = dedupeByName([
      item('a', 'HIDE 1.1 - Biały', '798', 0.95),
      item('b', 'AGAT R.2 - Dąb', '2220', 0.94),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((o) => o.variantCount)).toEqual([1, 1])
  })

  it('"bezprzylgowe" (inna nazwa) NIE zwija się z bazowym', () => {
    const out = dedupeByName([
      item('a', 'HIDE 1.1 - Biały', '798', 0.95),
      item('b', 'HIDE 1.1 bezprzylgowe - Biały', '820', 0.94),
    ])
    expect(out).toHaveLength(2)
  })

  it('singleton: variantCount=1, priceFrom = własna cena', () => {
    const out = dedupeByName([item('a', 'X - Y', '333', 0.9)])
    expect(out[0].variantCount).toBe(1)
    expect(out[0].priceFrom).toBe('333')
  })

  it('zachowuje kolejność rankingu (pierwsze wystąpienie nazwy)', () => {
    const out = dedupeByName([
      item('a', 'A - x', '10', 0.99),
      item('b', 'B - y', '20', 0.98),
      item('c', 'A - x', '5', 0.97),
    ])
    expect(out.map((o) => o.id)).toEqual(['a', 'b'])
    expect(out[0].priceFrom).toBe('5') // min z grupy A mimo że rep to 'a'
  })

  it('cena niebędąca liczbą nie psuje min', () => {
    const out = dedupeByName([
      item('a', 'A - x', '—', 0.9),
      item('b', 'A - x', '100', 0.89),
    ])
    expect(out[0].priceFrom).toBe('100')
  })
})

describe('applyMMR — zachowuje variantCount/priceFrom', () => {
  it('nowe pola przechodzą przez MMR', () => {
    const c = {
      id: 'a',
      similarity: 0.9,
      embedding: [1, 0],
      metadata: { name: 'A', price: '10', imageUrl: '' },
      variantCount: 3,
      priceFrom: '5',
    }
    const [out] = applyMMR([c], 1)
    expect(out.variantCount).toBe(3)
    expect(out.priceFrom).toBe('5')
    expect(out).not.toHaveProperty('embedding')
  })
})
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `cd backend && npx vitest run src/services/__tests__/chromaService.test.ts`
Expected: FAIL — `dedupeByName` nie istnieje; test MMR: `variantCount` undefined (bo obecne `map` odtwarza tylko id/similarity/metadata).

- [ ] **Step 3: `chromaService.ts` — pola, dedupeByName, MMR, wpięcie**

(a) Rozszerz `SearchResultItem` (linie ~47-51) o dwa opcjonalne pola:
```ts
export interface SearchResultItem {
  id: string
  similarity: number
  metadata: ProductMetadata
  /** liczba wariantów o tej samej nazwie w puli (>=1) */
  variantCount?: number
  /** cena najtańszego wariantu w grupie (string, jak metadata.price) */
  priceFrom?: string
}
```

(b) Dodaj `dedupeByName` (obok `applySeededJitter`):
```ts
// Warianty tego samego model+koloru (różne linie/ceny) mają w feedzie IDENTYCZNĄ
// nazwę — w siatce wyglądają jak powtórki. Zwijamy je do jednego reprezentanta
// (najlepiej dopasowanego), z ceną „od" (najtańszy w grupie) i licznikiem.
// Dane w Chromie zostają — to tylko prezentacja. Wejście jest już posortowane
// rankingiem, więc pierwsze wystąpienie nazwy = najlepszy wariant.
export function dedupeByName<T extends SearchResultItem & { embedding: number[] }>(
  candidates: T[],
): T[] {
  const rep = new Map<string, T>()
  const count = new Map<string, number>()
  const minPrice = new Map<string, number>()
  const minPriceStr = new Map<string, string>()
  for (const c of candidates) {
    const name = c.metadata.name
    count.set(name, (count.get(name) ?? 0) + 1)
    const p = Number(c.metadata.price)
    if (!Number.isNaN(p) && p < (minPrice.get(name) ?? Infinity)) {
      minPrice.set(name, p)
      minPriceStr.set(name, c.metadata.price)
    }
    if (!rep.has(name)) rep.set(name, c)
  }
  return [...rep.values()].map((c) => ({
    ...c,
    variantCount: count.get(c.metadata.name)!,
    priceFrom: minPriceStr.get(c.metadata.name) ?? c.metadata.price,
  }))
}
```

(c) W `applyMMR`, zmień KOŃCOWĄ linię z:
```ts
  return selected.map(({ id, similarity, metadata }) => ({ id, similarity, metadata }))
```
na (odcina tylko embedding, zachowuje variantCount/priceFrom):
```ts
  return selected.map(({ embedding, ...rest }) => rest)
```

(d) W `searchSimilar`, między jitterem a MMR:
```ts
  const ranked = seed ? applySeededJitter(candidates, seed) : candidates
  const deduped = dedupeByName(ranked)
  const results = applyMMR(deduped, n)
```
(zamień istniejące `const results = applyMMR(ranked, n)` na dwie linie powyżej).

- [ ] **Step 4: `search.ts` — przekaż pola do payloadu**

W `backend/src/routes/search.ts`, w `toProducts`, dołóż dwa pola do zwracanego obiektu (obok `hasGlass: r.metadata.has_glass`):
```ts
    variantCount: r.variantCount,
    priceFrom: r.priceFrom,
```

- [ ] **Step 5: Uruchom testy + typecheck**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: wszystkie PASS; typecheck czysto.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chromaService.ts backend/src/routes/search.ts backend/src/services/__tests__/chromaService.test.ts
git commit -m "feat(dedupe): dedupeByName w pipeline + variantCount/priceFrom w wyniku"
```

---

### Task 2: Frontend — karta „od {min} zł" + licznik + e2e

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/ProductCard.tsx`

**Interfaces:**
- Consumes: `priceFrom`, `variantCount` z payloadu produktu.

- [ ] **Step 1: `types/index.ts` — rozszerz `Product`**

Dodaj dwa opcjonalne pola do interfejsu `Product`:
```ts
  /** cena najtańszego wariantu tej samej nazwy — gdy variantCount > 1 */
  priceFrom?: string
  /** liczba wariantów o tej samej nazwie (model+kolor) */
  variantCount?: number
```

- [ ] **Step 2: `ProductCard.tsx` — kwota z priceFrom + licznik wariantów**

(a) W bloku ceny (linie ~67-73), zmień źródło kwoty na `priceFrom ?? price`:
```tsx
      <div className="mt-auto flex items-baseline justify-between gap-2">
        <span className="font-display text-[16px] text-ink [font-variant-numeric:tabular-nums]">
          {formatPrice(product.priceFrom ?? product.price)} zł{' '}
          <small className="font-sans text-[10px] uppercase tracking-[0.05em] text-ink-soft">
            od
          </small>
        </span>
        {product.productUrl && (
          <span className="whitespace-nowrap border-b border-current text-[13px] text-brass transition-colors group-hover:text-brass-deep">
            konfigurator →
          </span>
        )}
      </div>
```

(b) Dodaj dyskretny licznik wariantów pod ceną, gdy `variantCount > 1`. Wstaw
TUŻ PO powyższym `<div className="mt-auto ...">...</div>`, przed zamknięciem `</article>`:
```tsx
      {product.variantCount && product.variantCount > 1 && (
        <p className="m-0 -mt-1 text-[11px] text-ink-soft/80">
          {product.variantCount} warianty w konfiguratorze
        </p>
      )}
```

- [ ] **Step 3: Typecheck + testy + build**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run && npm run build`
Expected: tsc czysto, vitest PASS, build zielony.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/components/ProductCard.tsx
git commit -m "feat(dedupe): karta pokazuje od {min} zł i liczbę wariantów"
```

- [ ] **Step 5: E2e (kontroler zweryfikuje osobno — implementer NIE uruchamia przeglądarki)**

Po scaleniu Task 1+2 kontroler sprawdzi w przeglądarce: zapytanie łapiące grupę
dup → w siatce brak powtórzonych nazw; karta multi-wariant pokazuje „od {min} zł"
i „N warianty w konfiguratorze". Implementer tego kroku NIE wykonuje.

---

## Definicja ukończenia

- Testy jednostkowe `dedupeByName` + `applyMMR` zielone; backend vitest (108+) i front (21+) zielone; typecheck backend+front czyste; `npm run build` zielony.
- E2e (kontroler): zapytanie na grupę dup zwraca unikatowe nazwy w siatce; karta multi-wariant „od {min} zł" + licznik.
- Dane w Chromie nietknięte.
- Punkt powrotu: `master` @ 8741df8.
