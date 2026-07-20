import { useState, useCallback } from 'react'
import type { ApiResponse, AppState, SearchResult, SearchStage } from '@/types'
import { mockSearchByImage } from '@/lib/mockApi'

const USE_MOCK = false // przełącz na true żeby używać mock danych bez backendu

interface UseSearchReturn {
  appState: AppState
  searchStage: SearchStage
  searchResult: SearchResult | null
  errorMessage: string | null
  search: (file: File) => Promise<void>
  refine: (query: string, style?: string | null) => Promise<void>
  reset: () => void
}

export function useSearch(): UseSearchReturn {
  const [appState, setAppState] = useState<AppState>('idle')
  const [searchStage, setSearchStage] = useState<SearchStage>('analyzing')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const applyResult = useCallback((result: SearchResult) => {
    if (result.products.length === 0) {
      setAppState('empty-catalog')
      return
    }
    setSearchResult(result)
    setAppState(result.status === 'low-similarity' ? 'low-similarity' : 'success')
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

      if (USE_MOCK) {
        const response = await mockSearchByImage(file)
        if (response.error) applyError(response)
        else applyResult(response.data!)
        return
      }

      const { searchByImage } = await import('@/lib/api')
      const response = await searchByImage(file, {
        onStage: setSearchStage,
        onResult: applyResult,
        onReasons: mergeReasons,
      })
      applyError(response)
    },
    [applyResult, applyError, mergeReasons],
  )

  const refine = useCallback(
    async (query: string, style?: string | null) => {
      setAppState('loading')
      setSearchStage('analyzing')
      setErrorMessage(null)

      const { searchByText } = await import('@/lib/api')
      const response = await searchByText(query, { style: style ?? null }, {
        onStage: setSearchStage,
        onResult: applyResult,
        onReasons: mergeReasons,
      })
      applyError(response)
    },
    [applyResult, applyError, mergeReasons],
  )

  const reset = useCallback(() => {
    setAppState('idle')
    setSearchResult(null)
    setErrorMessage(null)
  }, [])

  return { appState, searchStage, searchResult, errorMessage, search, refine, reset }
}
