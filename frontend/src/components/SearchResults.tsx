import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, PackageSearch, SearchX, Sparkles, ScanSearch } from 'lucide-react'
import { AppState, SearchResult, SearchStage } from '@/types'
import { ResultsGrid } from './ResultsGrid'

interface SearchResultsProps {
  appState: AppState
  searchStage: SearchStage
  searchResult: SearchResult | null
  errorMessage?: string | null
  onRefine: (query: string) => void
}

const STAGES: Array<{ key: SearchStage; label: string; icon: typeof Sparkles }> = [
  { key: 'analyzing', label: 'Analizuję Twoje wnętrze…', icon: Sparkles },
  { key: 'matching', label: 'Dopasowuję drzwi z katalogu…', icon: ScanSearch },
]

function LoadingStages({ stage }: { stage: SearchStage }) {
  const activeIdx = STAGES.findIndex((s) => s.key === stage)
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      {STAGES.map(({ key, label, icon: Icon }, i) => {
        const isActive = i === activeIdx
        const isDone = i < activeIdx
        return (
          <div
            key={key}
            className={`flex items-center gap-2 text-sm transition-colors ${
              isActive ? 'text-blue-600' : isDone ? 'text-gray-400 line-through' : 'text-gray-300'
            }`}
          >
            {isActive ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Icon className="h-4 w-4" />
            )}
            {label}
          </div>
        )
      })}
    </div>
  )
}

export function SearchResults({
  appState,
  searchStage,
  searchResult,
  errorMessage,
  onRefine,
}: SearchResultsProps) {
  const [refineQuery, setRefineQuery] = useState('')

  const displayDescription = searchResult?.displayDescription ?? searchResult?.description ?? ''

  useEffect(() => {
    setRefineQuery(displayDescription)
  }, [displayDescription])

  if (appState === 'idle') return null

  if (appState === 'loading') {
    return <LoadingStages stage={searchStage} />
  }

  if (appState === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-500">Coś poszło nie tak. Spróbuj ponownie.</p>
        {errorMessage && (
          <p className="max-w-md text-center text-xs text-gray-400">{errorMessage}</p>
        )}
      </div>
    )
  }

  if (appState === 'empty-catalog') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <PackageSearch className="h-8 w-8" />
        <p className="text-sm">Katalog jest pusty. Zaimportuj feed produktowy, aby zacząć.</p>
      </div>
    )
  }

  if (!searchResult) return null

  const handleRefineSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = refineQuery.trim()
    if (q) onRefine(q)
  }

  return (
    <div>
      {displayDescription && (
        <div className="mb-6 flex flex-col items-center gap-2">
          <p className="text-sm text-gray-500">
            Dopasowane do Twojego wnętrza:{' '}
            <span className="font-medium text-gray-700">{displayDescription}</span>
          </p>
          <form onSubmit={handleRefineSubmit} className="flex w-full max-w-xl items-center gap-2">
            <input
              type="text"
              value={refineQuery}
              onChange={(e) => setRefineQuery(e.target.value)}
              placeholder="np. jasne drewniane drzwi ze szkłem"
              className="h-9 flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 text-sm text-gray-700 outline-none transition-colors focus:border-blue-400 focus:bg-white"
            />
            <button
              type="submit"
              disabled={!refineQuery.trim()}
              className="h-9 rounded-full bg-blue-500 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
            >
              Szukaj ponownie
            </button>
          </form>
          <p className="text-xs text-gray-400">
            Nie do końca to? Popraw opis powyżej i wyszukaj jeszcze raz.
          </p>
        </div>
      )}
      {appState === 'low-similarity' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <SearchX className="h-4 w-4 flex-shrink-0" />
          Nie znaleźliśmy bardzo bliskiego dopasowania. Spróbuj innego zdjęcia lub doprecyzuj opis.
        </div>
      )}
      <ResultsGrid products={searchResult.products} />
    </div>
  )
}
