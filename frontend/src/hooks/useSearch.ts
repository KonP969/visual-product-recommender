import { useState, useCallback } from 'react'
import { AppState, SearchResult } from '@/types'
import { mockSearchByImage } from '@/lib/mockApi'

const USE_MOCK = false // przełącz na true żeby używać mock danych bez backendu

interface UseSearchReturn {
  appState: AppState
  searchResult: SearchResult | null
  search: (file: File) => Promise<void>
  reset: () => void
}

export function useSearch(): UseSearchReturn {
  const [appState, setAppState] = useState<AppState>('idle')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)

  const search = useCallback(async (file: File) => {
    setAppState('loading')
    setSearchResult(null)

    const searchFn = USE_MOCK
      ? mockSearchByImage
      : (await import('@/lib/api')).searchByImage

    const response = await searchFn(file)

    if (response.error) {
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

  const reset = useCallback(() => {
    setAppState('idle')
    setSearchResult(null)
  }, [])

  return { appState, searchResult, search, reset }
}
