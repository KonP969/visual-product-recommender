import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Database } from 'lucide-react'

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

export function CatalogBrowser() {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchPage = useCallback(async (pageIndex: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/catalog/list?limit=${PAGE_SIZE}&offset=${pageIndex * PAGE_SIZE}`,
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
    if (open) fetchPage(page)
  }, [open, page, fetchPage])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
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
          {error && (
            <p className="px-4 py-3 text-sm text-red-500">{error}</p>
          )}

          {loading && (
            <p className="px-4 py-3 text-sm text-gray-400">Ładowanie…</p>
          )}

          {!loading && data && (
            <>
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {data.products.map((p) => (
                  <a
                    key={p.id}
                    href={p.metadata.productUrl ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col overflow-hidden rounded-lg border border-gray-100 transition-shadow hover:shadow-md"
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
                    <div className="flex flex-col gap-0.5 p-2">
                      <p className="line-clamp-2 text-xs leading-snug text-gray-700">
                        {p.metadata.name}
                      </p>
                      <p className="text-xs font-medium text-gray-900">
                        {p.metadata.price} zł
                      </p>
                    </div>
                  </a>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                  <span className="text-xs text-gray-400">
                    Strona {page + 1} z {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page === 0}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Poprzednia
                    </button>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= totalPages - 1}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                    >
                      Następna
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
