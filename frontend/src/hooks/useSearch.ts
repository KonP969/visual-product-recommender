import { useState, useCallback, useRef } from 'react'
import type { ApiResponse, AppState, SearchResult, SearchStage } from '@/types'
import { mockSearchByImage } from '@/lib/mockApi'

const USE_MOCK = false // przełącz na true żeby używać mock danych bez backendu

// Ile nowych produktów doładować na klik — to samo, co backend zwraca domyślnie
// na pierwszą stronę, więc "Pokaż więcej" wygląda jak naturalna kontynuacja.
const PAGE_SIZE = 10

// Ostatnie zapytanie do powtórzenia przy "Pokaż więcej" — obraz albo tekst,
// z dokładnie tymi samymi parametrami co przy oryginalnym wyszukiwaniu.
type OstatnieZapytanie =
  | { type: 'image'; file: File }
  | { type: 'text'; query: string; style: string | null; refinement?: string }

interface UseSearchReturn {
  appState: AppState
  searchStage: SearchStage
  searchResult: SearchResult | null
  errorMessage: string | null
  search: (file: File) => Promise<void>
  refine: (query: string, style?: string | null, refinement?: string) => Promise<void>
  reset: () => void
  loadMore: () => Promise<void>
  loadingMore: boolean
  hasMore: boolean
}

export function useSearch(): UseSearchReturn {
  const [appState, setAppState] = useState<AppState>('idle')
  const [searchStage, setSearchStage] = useState<SearchStage>('analyzing')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  // Ref, nie state: loadMore czyta zawsze najświeższe zapytanie/wyniki bez
  // czekania na re-render, tak samo jak refinement.ts robi to dla stanu chipów.
  const lastRequest = useRef<OstatnieZapytanie | null>(null)
  const productsRef = useRef<SearchResult['products']>([])

  const applyResult = useCallback((result: SearchResult) => {
    if (result.products.length === 0) {
      setAppState('empty-catalog')
      setHasMore(false)
      return
    }
    productsRef.current = result.products
    setSearchResult(result)
    setAppState(result.status === 'low-similarity' ? 'low-similarity' : 'success')
    setHasMore(result.products.length >= PAGE_SIZE)
  }, [])

  const applyError = useCallback((response: ApiResponse<SearchResult>) => {
    if (response.error) {
      setErrorMessage(response.error)
      setAppState('error')
    }
  }, [])

  // Uzasadnienia dopasowań docierają po wynikach — dopinamy je do produktów
  const mergeReasons = useCallback((reasons: Record<string, string>) => {
    setSearchResult((prev) =>
      prev
        ? {
            ...prev,
            products: prev.products.map((p) =>
              reasons[p.id] ? { ...p, why: reasons[p.id] } : p,
            ),
          }
        : prev,
    )
  }, [])

  const search = useCallback(
    async (file: File) => {
      setAppState('loading')
      setSearchStage('analyzing')
      setSearchResult(null)
      setErrorMessage(null)
      lastRequest.current = { type: 'image', file }

      if (USE_MOCK) {
        const response = await mockSearchByImage(file)
        if (response.error) applyError(response)
        else applyResult(response.data!)
        return
      }

      const { searchByImage } = await import('@/lib/api')
      const response = await searchByImage(
        file,
        {},
        {
          onStage: setSearchStage,
          onResult: applyResult,
          onReasons: mergeReasons,
        },
      )
      applyError(response)
    },
    [applyResult, applyError, mergeReasons],
  )

  const refine = useCallback(
    async (query: string, style?: string | null, refinement?: string) => {
      setAppState('loading')
      setSearchStage('analyzing')
      setErrorMessage(null)
      lastRequest.current = { type: 'text', query, style: style ?? null, refinement }

      const { searchByText } = await import('@/lib/api')
      const response = await searchByText(query, { style: style ?? null, refinement }, {
        onStage: setSearchStage,
        onResult: applyResult,
        onReasons: mergeReasons,
      })
      applyError(response)
    },
    [applyResult, applyError, mergeReasons],
  )

  // Powtarza OSTATNIE zapytanie (ten sam obraz/tekst — Gemini ma je w cache'u,
  // więc to tanie) z listą już pokazanych nazw do wykluczenia. Dokłada wynik
  // do istniejącej listy zamiast ją zastępować.
  const loadMore = useCallback(async () => {
    const zapytanie = lastRequest.current
    if (!zapytanie || loadingMore || !hasMore) return

    setLoadingMore(true)
    const excludeNames = productsRef.current.map((p) => p.name)

    const appendResult = (result: SearchResult) => {
      productsRef.current = [...productsRef.current, ...result.products]
      setSearchResult((prev) =>
        prev ? { ...prev, products: productsRef.current } : prev,
      )
      setHasMore(result.products.length >= PAGE_SIZE)
    }

    const { searchByImage, searchByText } = await import('@/lib/api')
    const response =
      zapytanie.type === 'image'
        ? await searchByImage(
            zapytanie.file,
            { excludeNames, n: PAGE_SIZE },
            { onResult: appendResult, onReasons: mergeReasons },
          )
        : await searchByText(
            zapytanie.query,
            { style: zapytanie.style, refinement: zapytanie.refinement, excludeNames, n: PAGE_SIZE },
            { onResult: appendResult, onReasons: mergeReasons },
          )
    setLoadingMore(false)
    if (response.error) setErrorMessage(response.error)
  }, [loadingMore, hasMore, mergeReasons])

  const reset = useCallback(() => {
    setAppState('idle')
    setSearchResult(null)
    setErrorMessage(null)
    setHasMore(false)
    lastRequest.current = null
    productsRef.current = []
  }, [])

  return {
    appState,
    searchStage,
    searchResult,
    errorMessage,
    search,
    refine,
    reset,
    loadMore,
    loadingMore,
    hasMore,
  }
}
