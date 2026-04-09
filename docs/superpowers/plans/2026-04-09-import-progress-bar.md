# Import Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fire-and-forget import with an SSE stream so the frontend can show a real-time progress bar with counters (new / skipped / failed).

**Architecture:** Backend streams SSE events (`progress`, `done`, `error`) during `runImport`. Frontend uses `fetch` + `ReadableStream` to consume the stream and update a progress bar in `ImportPanel`.

**Tech Stack:** Express SSE (no extra libs), React state, `fetch` Streams API, Tailwind v3.

---

## Files

| File | Change |
|------|--------|
| `backend/src/services/importService.ts` | Add `ImportProgress` type, `onProgress` callback, return value |
| `backend/src/routes/import.ts` | Replace JSON response with SSE stream |
| `frontend/src/components/ImportPanel.tsx` | Streaming fetch + progress bar UI |

---

### Task 1: Extend `importService.ts` with progress callback

**Files:**
- Modify: `backend/src/services/importService.ts`

- [ ] **Step 1: Replace the file with the updated version**

```typescript
import { parseFeed } from './feedParser'
import { downloadImage } from './imageDownloader'
import { getEmbedding } from './clipService'
import { upsertProduct, productExists } from './chromaService'

export interface ImportProgress {
  current: number
  total: number
  success: number
  skipped: number
  failed: number
}

export interface ImportOptions {
  limit?: number
  onProgress?: (p: ImportProgress) => void
}

export async function runImport(source: string, options: ImportOptions = {}): Promise<ImportProgress> {
  console.log(`[IMPORT] Parsing feed: ${source}`)
  const allProducts = await parseFeed(source)

  const products = options.limit
    ? allProducts.slice(0, options.limit)
    : allProducts

  console.log(
    `[IMPORT] Found ${allProducts.length} products, importing ${products.length}`,
  )

  let success = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    const label = `[${i + 1}/${products.length}]`

    try {
      const exists = await productExists(product.id)
      if (exists) {
        skipped++
        console.log(`[IMPORT] ${label} SKIP ${product.name}`)
      } else {
        const { buffer, mimetype } = await downloadImage(product.imageUrl)
        const embedding = await getEmbedding(buffer, mimetype)
        await upsertProduct(product.id, embedding, {
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          productUrl: product.productUrl,
        })
        success++
        console.log(`[IMPORT] ${label} ✓ ${product.name}`)
      }
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[IMPORT] ${label} ✗ ${product.name} — ${message}`)
    }

    options.onProgress?.({
      current: i + 1,
      total: products.length,
      success,
      skipped,
      failed,
    })
  }

  const result: ImportProgress = {
    current: products.length,
    total: products.length,
    success,
    skipped,
    failed,
  }

  console.log(
    `[IMPORT] Done. Total: ${products.length} | New: ${success} | Skipped: ${skipped} | Failed: ${failed}`,
  )

  return result
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/importService.ts
git commit -m "feat: add onProgress callback and return value to runImport"
```

---

### Task 2: Update `import.ts` route to stream SSE

**Files:**
- Modify: `backend/src/routes/import.ts`

- [ ] **Step 1: Replace the `/import` handler (keep `/import/preview` unchanged)**

Replace only the `importRouter.post('/import', ...)` handler (lines 9–38) with:

```typescript
importRouter.post('/import', async (req, res, next) => {
  try {
    const { feedUrl, feedPath, limit } = req.body as {
      feedUrl?: string
      feedPath?: string
      limit?: number
    }

    const source = feedUrl ?? (feedPath ? path.resolve(feedPath) : null)

    if (!source) {
      res.status(400).json({ error: 'feedUrl or feedPath is required' })
      return
    }

    const parsedLimit = limit ? Math.max(1, Math.floor(Number(limit))) : undefined

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const result = await runImport(source, {
        limit: parsedLimit,
        onProgress: (p) => send({ type: 'progress', ...p }),
      })
      send({ type: 'done', ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      send({ type: 'error', message })
      console.error('[IMPORT ERROR]', err instanceof Error ? err.stack : err)
    }

    res.end()
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/import.ts
git commit -m "feat: stream import progress via SSE"
```

---

### Task 3: Update `ImportPanel.tsx` — streaming fetch + progress bar UI

**Files:**
- Modify: `frontend/src/components/ImportPanel.tsx`

- [ ] **Step 1: Replace the entire file**

```typescript
import { useState } from 'react'
import { Upload, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type ImportStatus = 'idle' | 'loading' | 'importing' | 'success' | 'error'

interface ProgressState {
  current: number
  total: number
  success: number
  skipped: number
  failed: number
}

export function ImportPanel() {
  const [open, setOpen] = useState(false)
  const [feedUrl, setFeedUrl] = useState('')
  const [limit, setLimit] = useState('20')
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<ProgressState | null>(null)

  const handleImport = async () => {
    if (!feedUrl.trim()) return

    setStatus('loading')
    setMessage('')
    setProgress(null)

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedUrl: feedUrl.trim(),
          limit: limit ? Number(limit) : undefined,
        }),
      })

      if (!response.ok || !response.body) {
        const data = await response.json()
        setStatus('error')
        setMessage(data.error ?? 'Import failed')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as { type: string } & Record<string, unknown>
            if (event.type === 'progress') {
              setStatus('importing')
              setProgress(event as unknown as ProgressState)
            } else if (event.type === 'done') {
              const p = event as unknown as ProgressState
              setStatus('success')
              setProgress(p)
              setMessage(
                `Import zakończony — ${p.total} produktów: ${p.success} nowych, ${p.skipped} pominiętych, ${p.failed} błędów.`,
              )
            } else if (event.type === 'error') {
              setStatus('error')
              setMessage((event.message as string) ?? 'Import failed')
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch {
      setStatus('error')
      setMessage('Network error. Is the backend running?')
    }
  }

  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm text-gray-600 hover:text-gray-900"
      >
        <span className="flex items-center gap-2 font-medium">
          <Upload className="h-4 w-4" />
          Import product catalog
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Feed URL (XML)
              </label>
              <input
                type="url"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://example.com/product-feed.xml"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Limit produktów
              </label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                min={1}
                max={10000}
                placeholder="20"
                className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <span className="ml-2 text-xs text-gray-400">zostaw puste = cały feed</span>
            </div>

            <button
              onClick={handleImport}
              disabled={!feedUrl.trim() || status === 'loading' || status === 'importing'}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                feedUrl.trim() && status !== 'loading' && status !== 'importing'
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'cursor-not-allowed bg-gray-100 text-gray-400',
              )}
            >
              {status === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pobieranie XML…
                </>
              ) : status === 'importing' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importowanie…
                </>
              ) : (
                'Start import'
              )}
            </button>

            {(status === 'importing' || (status === 'success' && progress)) && progress && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>{status === 'importing' ? 'Importowanie produktów…' : 'Import zakończony'}</span>
                  <span className="font-medium">{pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-200',
                      status === 'success' ? 'bg-green-500' : 'bg-blue-500',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 text-center">
                  {progress.current} / {progress.total} produktów
                </div>
                <div className="flex justify-center gap-4 text-xs">
                  <span className="text-green-600">✓ Nowe: {progress.success}</span>
                  <span className="text-gray-500">↷ Pominięte: {progress.skipped}</span>
                  <span className="text-red-500">✗ Błędy: {progress.failed}</span>
                </div>
              </div>
            )}

            {message && (status === 'success' || status === 'error') && (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
                  status === 'success'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-600',
                )}
              >
                {status === 'success' ? (
                  <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                )}
                {message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify frontend builds**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ImportPanel.tsx
git commit -m "feat: add SSE progress bar to import panel"
```

---

## Manual Test Checklist

Po zakończeniu wszystkich tasków zweryfikuj ręcznie:

1. Otwórz http://localhost:5175 (lub inny port Vite)
2. Rozwiń panel "Import product catalog"
3. Wpisz URL XML i limit (np. 10)
4. Kliknij "Start import"
5. Oczekiwane: przycisk zmienia się na "Pobieranie XML…", następnie pojawia się pasek postępu
6. Pasek rośnie z każdym produktem, liczniki się aktualizują
7. Po zakończeniu: pasek zielony, widoczne finalne podsumowanie
