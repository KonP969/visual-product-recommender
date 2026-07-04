import { useState, useCallback } from 'react'
import { ApiResponse, AppState, SearchResult, SearchStage } from '@/types'
import { mockSearchByImage } from '@/lib/mockApi'

const USE_MOCK = false // przełącz na true żeby używać mock danych bez backendu

interface UseSearchReturn {
  appState: AppState
  searchStage: SearchStage
  searchResult: SearchResult | null
  errorMessage: string | null
  search: (file: File) => Promise<void>
  refine: (query: string) => Promise<void>
  reset: () => void
}

export function useSearch(): UseSearchReturn {
  const [appState, setAppState] = useState<AppState>('idle')
  const [searchStage, setSearchStage] = useState<SearchStage>('analyzing')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const applyResponse = useCallback((response: ApiResponse<SearchResult>) => {
    if (response.error) {
      setErrorMessage(response.error)
      setAppState('error')
      return
    }

    const result = response.data!

    if (result.products.length === 0) {
      setAppState('empty-catalog')
      return
    }

    setSearchResult(result)
    setAppState(result.status === 'low-similarity' ? 'low-similarity' : 'success')
  }, [])

  const search = useCallback(async (file: File) => {
    setAppState('loading')
    setSearchStage('analyzing')
    setSearchResult(null)
    setErrorMessage(null)

    const response = USE_MOCK
      ? await mockSearchByImage(file)
      : await (await import('@/lib/api')).searchByImage(file, setSearchStage)

    applyResponse(response)
  }, [applyResponse])

  const refine = useCallback(async (query: string) => {
    setAppState('loading')
    setSearchStage('matching')
    setErrorMessage(null)

    const response = await (await import('@/lib/api')).searchByText(query)
    applyResponse(response)
  }, [applyResponse])

  const reset = useCallback(() => {
    setAppState('idle')
    setSearchResult(null)
    setErrorMessage(null)
  }, [])

  return { appState, searchStage, searchResult, errorMessage, search, refine, reset }
}
