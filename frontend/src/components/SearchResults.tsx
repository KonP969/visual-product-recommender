import { Loader2, AlertCircle, PackageSearch, SearchX } from 'lucide-react'
import { AppState, SearchResult } from '@/types'
import { ResultsGrid } from './ResultsGrid'

interface SearchResultsProps {
  appState: AppState
  searchResult: SearchResult | null
}

export function SearchResults({ appState, searchResult }: SearchResultsProps) {
  if (appState === 'idle') return null

  if (appState === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Searching for similar products…</p>
      </div>
    )
  }

  if (appState === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-500">Something went wrong. Please try again.</p>
      </div>
    )
  }

  if (appState === 'empty-catalog') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <PackageSearch className="h-8 w-8" />
        <p className="text-sm">No products in catalog. Import a product feed to get started.</p>
      </div>
    )
  }

  if (!searchResult) return null

  return (
    <div>
      {appState === 'low-similarity' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <SearchX className="h-4 w-4 flex-shrink-0" />
          We couldn't find a close match. Try a different photo.
        </div>
      )}
      <ResultsGrid products={searchResult.products} />
    </div>
  )
}
