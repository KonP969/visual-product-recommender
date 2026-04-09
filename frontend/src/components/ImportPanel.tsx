import { useState, useRef } from 'react'
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

interface SSEProgress { type: 'progress'; current: number; total: number; success: number; skipped: number; failed: number }
interface SSEDone    { type: 'done';     current: number; total: number; success: number; skipped: number; failed: number }
interface SSEError   { type: 'error';    message: string }
type SSEEvent = SSEProgress | SSEDone | SSEError

export function ImportPanel() {
  const [open, setOpen] = useState(false)
  const [feedUrl, setFeedUrl] = useState('')
  const [limit, setLimit] = useState('20')
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const handleImport = async () => {
    if (!feedUrl.trim()) return

    const controller = new AbortController()
    controllerRef.current = controller

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
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        let errorMsg = 'Import failed'
        try {
          const data = await response.json()
          errorMsg = data.error ?? errorMsg
        } catch { /* body was not JSON */ }
        setStatus('error')
        setMessage(errorMsg)
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
            const event = JSON.parse(line.slice(6)) as SSEEvent
            if (event.type === 'progress') {
              const { type: _type, ...p } = event
              setStatus('importing')
              setProgress(p)
            } else if (event.type === 'done') {
              const { type: _type, ...p } = event
              setStatus('success')
              setProgress(p)
              setMessage(
                `Import zakończony — ${p.total} produktów: ${p.success} nowych, ${p.skipped} pominiętych, ${p.failed} błędów.`,
              )
            } else if (event.type === 'error') {
              setStatus('error')
              setMessage(event.message ?? 'Import failed')
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

            {progress && progress.total > 0 && (status === 'importing' || status === 'success') && (
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
