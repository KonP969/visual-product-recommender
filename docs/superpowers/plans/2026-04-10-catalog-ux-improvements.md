# Catalog UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add feed total counter to import panel, numbered page buttons to catalog browser, and partial-name text search to catalog browser.

**Architecture:** Three independent features touching backend services/routes and frontend components. Feature 1 threads `feedTotal` through existing SSE pipeline. Feature 2 replaces the pagination bar in `CatalogBrowser`. Feature 3 adds `searchProductsByName` to ChromaService and wires it through the catalog list endpoint and `CatalogBrowser`.

**Tech Stack:** TypeScript, Express, ChromaDB JS client, React 18, Tailwind v3

---

## File Map

| File | Change |
|------|--------|
| `backend/src/services/importService.ts` | Add `feedTotal` to `ImportProgress`, pass it through |
| `backend/src/services/chromaService.ts` | Add `searchProductsByName` function |
| `backend/src/routes/catalog.ts` | Support `?q` query param in `/catalog/list` |
| `frontend/src/components/ImportPanel.tsx` | Show `feedTotal` in progress bar label and success message |
| `frontend/src/components/CatalogBrowser.tsx` | Add numbered paginator + search input |

---

## Task 1: Add `feedTotal` to backend import pipeline

**Files:**
- Modify: `backend/src/services/importService.ts`

- [ ] **Step 1: Add `feedTotal` to `ImportProgress` interface and `runImport`**

Replace the existing `ImportProgress` interface and update `runImport` in `backend/src/services/importService.ts`:

```ts
export interface ImportProgress {
  current: number
  total: number      // products being imported (after limit applied)
  feedTotal: number  // all products parsed from the XML
  success: number
  skipped: number
  failed: number
}
```

In `runImport`, update the `onProgress` call (inside the loop) and the final `result` object:

```ts
options.onProgress?.({
  current: i + 1,
  total: products.length,
  feedTotal: allProducts.length,
  success,
  skipped,
  failed,
})
```

```ts
const result: ImportProgress = {
  current: products.length,
  total: products.length,
  feedTotal: allProducts.length,
  success,
  skipped,
  failed,
}
```

- [ ] **Step 2: Verify backend compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/importService.ts
git commit -m "feat: add feedTotal to ImportProgress SSE events"
```

---

## Task 2: Show feed total in `ImportPanel`

**Files:**
- Modify: `frontend/src/components/ImportPanel.tsx`

- [ ] **Step 1: Update TypeScript types to include `feedTotal`**

In `frontend/src/components/ImportPanel.tsx`, update the types:

```ts
interface ProgressState {
  current: number
  total: number
  feedTotal: number
  success: number
  skipped: number
  failed: number
}

interface SSEProgress { type: 'progress'; current: number; total: number; feedTotal: number; success: number; skipped: number; failed: number }
interface SSEDone    { type: 'done';     current: number; total: number; feedTotal: number; success: number; skipped: number; failed: number }
interface SSEError   { type: 'error';    message: string }
```

- [ ] **Step 2: Update the progress label during import**

Find the block that renders `{status === 'importing' ? 'Importowanie produktów…' : 'Import zakończony'}` and replace with:

```tsx
<span>
  {status === 'importing'
    ? `Importowanie ${progress.total} z ${progress.feedTotal} w XML…`
    : 'Import zakończony'}
</span>
```

- [ ] **Step 3: Update the success message to include feed percentage**

Find the `setMessage(...)` call inside `else if (event.type === 'done')` and replace with:

```ts
const pctOfFeed = p.feedTotal > 0
  ? ` (${Math.round((p.total / p.feedTotal) * 100)}% feedu)`
  : ''
setMessage(
  `Zaimportowano ${p.total} z ${p.feedTotal} produktów feedu${pctOfFeed} — ${p.success} nowych, ${p.skipped} pominiętych, ${p.failed} błędów.`,
)
```

- [ ] **Step 4: Verify frontend compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ImportPanel.tsx
git commit -m "feat: show feedTotal and feed percentage in ImportPanel"
```

---

## Task 3: Add `searchProductsByName` to ChromaService

**Files:**
- Modify: `backend/src/services/chromaService.ts`

- [ ] **Step 1: Add the function at the bottom of `chromaService.ts`**

```ts
export async function searchProductsByName(
  query: string,
  limit: number,
  offset: number,
): Promise<{ products: { id: string; metadata: ProductMetadata }[]; total: number }> {
  const col = await getCollection()
  const q = query.toLowerCase()
  const BATCH = 500
  const matched: { id: string; metadata: ProductMetadata }[] = []
  let batchOffset = 0

  while (true) {
    const result = await col.get({ limit: BATCH, offset: batchOffset, include: ['metadatas'] })
    if (result.ids.length === 0) break

    for (let i = 0; i < result.ids.length; i++) {
      const metadata = result.metadatas[i] as unknown as ProductMetadata
      if (metadata.name.toLowerCase().includes(q)) {
        matched.push({ id: result.ids[i], metadata })
      }
    }

    batchOffset += result.ids.length
    if (result.ids.length < BATCH) break
  }

  const total = matched.length
  const products = matched.slice(offset, offset + limit)
  return { products, total }
}
```

- [ ] **Step 2: Verify backend compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/chromaService.ts
git commit -m "feat: add searchProductsByName to chromaService"
```

---

## Task 4: Wire `?q` search param into `/catalog/list` route

**Files:**
- Modify: `backend/src/routes/catalog.ts`

- [ ] **Step 1: Import `searchProductsByName` and handle `?q` in the list handler**

Replace the existing `catalogRouter.get('/catalog/list', ...)` handler:

```ts
import { Router } from 'express'
import {
  getProductCount,
  listProducts,
  getProductEmbedding,
  searchProductsByName,
} from '../services/chromaService'

export const catalogRouter = Router()

catalogRouter.get('/catalog/stats', async (_req, res, next) => {
  try {
    const count = await getProductCount()
    res.json({ count })
  } catch (err) {
    next(err)
  }
})

catalogRouter.get('/catalog/embedding/:id', async (req, res, next) => {
  try {
    const result = await getProductEmbedding(req.params.id)
    if (!result) {
      res.status(404).json({ error: 'Product not found' })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

catalogRouter.get('/catalog/list', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100)
    const offset = Number(req.query.offset ?? 0)
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    if (q) {
      const { products, total } = await searchProductsByName(q, limit, offset)
      res.json({ products, total, limit, offset })
    } else {
      const [products, total] = await Promise.all([
        listProducts(limit, offset),
        getProductCount(),
      ])
      res.json({ products, total, limit, offset })
    }
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 2: Verify backend compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/catalog.ts
git commit -m "feat: add ?q search param to /catalog/list route"
```

---

## Task 5: Add numbered paginator and search to `CatalogBrowser`

**Files:**
- Modify: `frontend/src/components/CatalogBrowser.tsx`

- [ ] **Step 1: Add imports and helper function for page range**

At the top of `frontend/src/components/CatalogBrowser.tsx`, add `Search` and `X` to the lucide import:

```ts
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Database, BarChart2, Search, X } from 'lucide-react'
```

Add `useRef` to the React import:

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
```

Add the `getPageRange` helper above the component:

```ts
function getPageRange(current: number, total: number): (number | null)[] {
  if (total <= 1) return [0]
  const pages = new Set<number>()
  pages.add(0)
  pages.add(total - 1)
  pages.add(current)
  if (current - 1 >= 0) pages.add(current - 1)
  if (current + 1 < total) pages.add(current + 1)

  const sorted = Array.from(pages).sort((a, b) => a - b)
  const result: (number | null)[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push(null)
    result.push(sorted[i])
  }
  return result
}
```

- [ ] **Step 2: Add `searchQuery`, `debouncedQuery` state and debounce ref**

Inside `CatalogBrowser`, add after the existing state declarations:

```ts
const [searchQuery, setSearchQuery] = useState('')       // input value (immediate)
const [debouncedQuery, setDebouncedQuery] = useState('') // sent to API (debounced)
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

- [ ] **Step 3: Update `fetchPage` to accept and use the debounced query**

Replace the existing `fetchPage`:

```ts
const fetchPage = useCallback(async (pageIndex: number, q: string) => {
  setLoading(true)
  setError('')
  try {
    const qParam = q ? `&q=${encodeURIComponent(q)}` : ''
    const res = await fetch(
      `/api/catalog/list?limit=${PAGE_SIZE}&offset=${pageIndex * PAGE_SIZE}${qParam}`,
    )
    if (!res.ok) throw new Error('Failed to load catalog')
    setData(await res.json())
  } catch {
    setError('Nie można załadować katalogu. Czy backend działa?')
  } finally {
    setLoading(false)
  }
}, [])
```

- [ ] **Step 4: Update the `useEffect` to depend on `debouncedQuery` (not `searchQuery`)**

Replace the existing `useEffect`:

```ts
useEffect(() => {
  if (open) fetchPage(page, debouncedQuery)
}, [open, page, debouncedQuery, fetchPage])
```

- [ ] **Step 5: Add search input handler — debounces both page reset and API call**

Add this handler inside the component (before the return):

```ts
const handleSearchChange = (value: string) => {
  setSearchQuery(value)
  if (debounceRef.current) clearTimeout(debounceRef.current)
  debounceRef.current = setTimeout(() => {
    setPage(0)
    setDebouncedQuery(value)
  }, 300)
}
```

- [ ] **Step 6: Replace the pagination bar and add search input in JSX**

Inside the `{open && ...}` block, add the search input right after `<div className="border-t border-gray-100">`:

```tsx
<div className="px-4 pt-3 pb-2">
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
    <input
      type="text"
      value={searchQuery}
      onChange={(e) => handleSearchChange(e.target.value)}
      placeholder="Szukaj po nazwie…"
      className="w-full rounded-lg border border-gray-200 pl-8 pr-8 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
    />
    {searchQuery && (
      <button
        onClick={() => handleSearchChange('')}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
  {searchQuery && data && (
    <p className="mt-1.5 text-xs text-gray-500">
      {data.total} {data.total === 1 ? 'wynik' : 'wyników'} dla „{searchQuery}"
    </p>
  )}
  {searchQuery && data && data.total === 0 && (
    <p className="mt-2 text-sm text-gray-400">Brak produktów pasujących do „{searchQuery}"</p>
  )}
</div>
```

- [ ] **Step 7: Replace the Poprzednia/Następna pagination bar**

Replace the existing `{totalPages > 1 && (...)}` block with:

```tsx
{totalPages > 1 && (
  <div className="flex items-center justify-center gap-1 border-t border-gray-100 px-4 py-3 flex-wrap">
    <button
      onClick={() => setPage((p) => p - 1)}
      disabled={page === 0}
      className="flex items-center rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
    </button>

    {getPageRange(page, totalPages).map((p, i) =>
      p === null ? (
        <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400 select-none">…</span>
      ) : (
        <button
          key={p}
          onClick={() => setPage(p)}
          className={[
            'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
            p === page
              ? 'border-blue-500 bg-blue-500 text-white font-medium'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          {p + 1}
        </button>
      ),
    )}

    <button
      onClick={() => setPage((p) => p + 1)}
      disabled={page >= totalPages - 1}
      className="flex items-center rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
    >
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  </div>
)}
```

- [ ] **Step 8: Verify frontend compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/CatalogBrowser.tsx
git commit -m "feat: add numbered pagination and name search to CatalogBrowser"
```

---

## Task 6: Manual smoke test

With all 4 services running (ChromaDB, Python sidecar, backend, frontend):

- [ ] **Import test:** trigger an import with a `limit` smaller than the feed size. Verify the progress label shows *"Importowanie X z Y w XML…"* and the success message shows the feed percentage.
- [ ] **Paginator test:** open Catalog browser — numbered page buttons appear when there are >20 products. Clicking a number jumps directly to that page.
- [ ] **Search test:** type a partial product name (e.g. `drzwi`). Verify results filter, count badge appears, clearing `×` resets to full catalog.
- [ ] **Search + pagination test:** search for a common word that returns >20 results. Verify paginator shows correct page count for the filtered results.
