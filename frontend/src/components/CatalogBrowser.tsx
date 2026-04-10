import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Database, BarChart2, Search, X } from 'lucide-react'
import { EmbeddingModal } from './EmbeddingModal'

interface Product {
  id: string
  metadata: {
    name: string
    price: string
    imageUrl: string
    productUrl?: string
  }
}

interface CatalogResponse {
  products: Product[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 20

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

export function CatalogBrowser() {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [embeddingProductId, setEmbeddingProductId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')       // input value (immediate)
  const [debouncedQuery, setDebouncedQuery] = useState('') // sent to API (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  useEffect(() => {
    if (open) fetchPage(page, debouncedQuery)
  }, [open, page, debouncedQuery, fetchPage])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(0)
      setDebouncedQuery(value)
    }, 300)
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <>
      <div className="w-full max-w-5xl rounded-xl border border-gray-200 bg-white">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm text-gray-600 hover:text-gray-900"
        >
          <span className="flex items-center gap-2 font-medium">
            <Database className="h-4 w-4" />
            Catalog browser
            {data && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {data.total} produktów
              </span>
            )}
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {open && (
          <div className="border-t border-gray-100">
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
              {searchQuery && data && data.total > 0 && (
                <p className="mt-1.5 text-xs text-gray-500">
                  {data.total} {data.total === 1 ? 'wynik' : 'wyników'} dla „{searchQuery}"
                </p>
              )}
              {searchQuery && data && data.total === 0 && (
                <p className="mt-2 text-sm text-gray-400">Brak produktów pasujących do „{searchQuery}"</p>
              )}
            </div>

            {error && (
              <p className="px-4 py-3 text-sm text-red-500">{error}</p>
            )}

            {loading && (
              <p className="px-4 py-3 text-sm text-gray-400">Ładowanie…</p>
            )}

            {!loading && data && data.products.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {data.products.map((p) => (
                    <div
                      key={p.id}
                      className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-100 transition-shadow hover:shadow-md"
                    >
                      <a
                        href={p.metadata.productUrl ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col"
                      >
                        <div className="aspect-square overflow-hidden bg-gray-50">
                          <img
                            src={p.metadata.imageUrl}
                            alt={p.metadata.name}
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%23f3f4f6"/%3E%3C/svg%3E'
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-0.5 p-2 pb-1">
                          <p className="line-clamp-2 text-xs leading-snug text-gray-700">
                            {p.metadata.name}
                          </p>
                          <p className="text-xs font-medium text-gray-900">
                            {p.metadata.price} zł
                          </p>
                        </div>
                      </a>
                      <button
                        onClick={() => setEmbeddingProductId(p.id)}
                        title="Podejrzyj embedding CLIP"
                        className="mx-2 mb-2 flex items-center justify-center gap-1 rounded bg-gray-100 py-1 text-[10px] text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <BarChart2 className="h-3 w-3" />
                        embedding
                      </button>
                    </div>
                  ))}
                </div>

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
              </>
            )}
          </div>
        )}
      </div>

      {embeddingProductId && (
        <EmbeddingModal
          productId={embeddingProductId}
          onClose={() => setEmbeddingProductId(null)}
        />
      )}
    </>
  )
}
