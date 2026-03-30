import { useState } from 'react'
import { Upload, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type ImportStatus = 'idle' | 'loading' | 'success' | 'error'

export function ImportPanel() {
  const [open, setOpen] = useState(false)
  const [feedUrl, setFeedUrl] = useState('')
  const [limit, setLimit] = useState('20')
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [message, setMessage] = useState('')

  const handleImport = async () => {
    if (!feedUrl.trim()) return

    setStatus('loading')
    setMessage('')

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedUrl: feedUrl.trim(),
          limit: limit ? Number(limit) : undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setStatus('error')
        setMessage(data.error ?? 'Import failed')
        return
      }

      setStatus('success')
      const limitLabel = data.limit === 'all' ? 'all' : `${data.limit}`
      setMessage(`Import started — ${limitLabel} products from feed. Check backend logs for progress.`)
    } catch {
      setStatus('error')
      setMessage('Network error. Is the backend running?')
    }
  }

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
              disabled={!feedUrl.trim() || status === 'loading'}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                feedUrl.trim() && status !== 'loading'
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'cursor-not-allowed bg-gray-100 text-gray-400',
              )}
            >
              {status === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing…
                </>
              ) : (
                'Start import'
              )}
            </button>

            {message && (
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
