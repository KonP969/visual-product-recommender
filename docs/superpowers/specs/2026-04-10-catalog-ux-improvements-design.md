# Design: Catalog UX Improvements

**Date:** 2026-04-10  
**Status:** Approved

## Overview

Three UX improvements to the import panel and catalog browser:
1. Feed total counter — show how many products are in the full XML vs. how many were imported
2. Pagination with page numbers — replace Poprzednia/Następna with numbered page buttons
3. Text search by product name — filter catalog by partial name match

---

## Feature 1: Feed Total Counter

### Backend (`backend/src/services/importService.ts`)

Add `feedTotal` to `ImportProgress`:

```ts
export interface ImportProgress {
  current: number
  total: number       // products being imported (after limit)
  feedTotal: number   // all products found in the XML
  success: number
  skipped: number
  failed: number
}
```

`runImport` already has `allProducts.length` — include it in every `onProgress` call and in the returned result.

### SSE Events (`backend/src/routes/import.ts`)

No changes needed — `feedTotal` is part of `ImportProgress` and gets spread into every SSE event automatically.

### Frontend (`frontend/src/components/ImportPanel.tsx`)

- `ProgressState` and `SSEProgress`/`SSEDone` types get `feedTotal: number`
- During import (progress bar label): *"Importowanie 2000 z 47 381 w XML…"*
- After import (success message): *"2000 z 47 381 produktów feedu (4%) — 1850 nowych, 150 pominiętych, 0 błędów"*
- Percentage: `Math.round((total / feedTotal) * 100)`

---

## Feature 2: Pagination with Page Numbers

### Frontend (`frontend/src/components/CatalogBrowser.tsx`)

Replace the current Poprzednia/Następna bar with a smart numbered paginator.

**Page range algorithm** — returns array of page indices + `null` for ellipsis:

```
getPageRange(current, total) → (number | null)[]
```

Rules (max ~7 visible slots):
- Always show page 0 (first) and total-1 (last)
- Always show current-1, current, current+1 (when in range)
- Insert `null` where gap > 1

Examples (0-indexed, displayed as 1-indexed):
- Page 0 of 47: `0 1 2 … 46`
- Page 4 of 47: `0 … 3 4 5 … 46`
- Page 45 of 47: `0 … 44 45 46`

**Rendered buttons:**
- `null` → `…` (non-clickable span)
- Current page → filled/active style
- Other pages → clickable, hover style
- `←` / `→` arrows at the edges, disabled at boundaries

No API or fetch logic changes.

---

## Feature 3: Text Search by Product Name

### Backend

**`backend/src/services/chromaService.ts`** — add `searchProductsByName`:

```ts
export async function searchProductsByName(
  query: string,
  limit: number,
  offset: number,
): Promise<{ products: { id: string; metadata: ProductMetadata }[]; total: number }>
```

Implementation:
- Lowercase `query` for case-insensitive matching
- Fetch products in batches of 500 from ChromaDB using `col.get()`
- Filter each batch: `name.toLowerCase().includes(query)`
- Collect matching products, apply `offset` / `limit` for pagination
- Return `{ products, total }` where `total` = all matching products count

**`backend/src/routes/catalog.ts`** — extend `/catalog/list`:

```
GET /api/catalog/list?limit=20&offset=0&q=fotel
```

When `q` is present and non-empty, delegate to `searchProductsByName`. Same response shape:
```json
{ "products": [...], "total": 142, "limit": 20, "offset": 0 }
```

### Frontend (`frontend/src/components/CatalogBrowser.tsx`)

- Add `searchQuery` state (string, default `""`)
- Search input above the product grid (visible when panel is open), placeholder *"Szukaj po nazwie…"*
- On input change: debounce 300ms → `setPage(0)` + re-fetch with `?q=searchQuery`
- When `searchQuery` is active: show badge above grid: *"142 wyniki dla „fotel""*
- Clearing the input → `searchQuery = ""` → normal catalog browse mode
- Pagination works identically for search results

---

## Data Flow

```
User types in search → debounce 300ms
  → setPage(0) + fetch /catalog/list?q=fotel&limit=20&offset=0
  → backend: searchProductsByName("fotel", 20, 0)
  → chromaDB: get batches, filter by name
  → return { products: [...20 items], total: 142 }
  → frontend: show grid + "142 wyniki dla „fotel"" + paginator
```

---

## Error Handling

- Empty search results: show *"Brak produktów pasujących do „xyz""* instead of empty grid
- Backend search error: same existing error handling (`setError(...)`)
- `feedTotal` missing from old SSE events (defensive): treat as 0, hide the "X z Y" label

---

## Out of Scope

- Search by product ID or URL
- Full-text indexing / ElasticSearch
- Real-time search without debounce
- Sorting catalog results
