import { Loader2, AlertCircle, PackageSearch, SearchX, Sparkles, ScanSearch } from 'lucide-react'
import { AppState, SearchResult, SearchStage } from '@/types'
import { ResultsGrid } from './ResultsGrid'

interface SearchResultsProps {
  appState: AppState
  searchStage: SearchStage
  searchResult: SearchResult | null
  errorMessage?: string | null
}

const STAGES: Array<{ key: SearchStage; label: string; icon: typeof Sparkles }> = [
  { key: 'analyzing', label: 'Analizuję Twoje wnętrze…', icon: Sparkles },
  { key: 'matching', label: 'Dopasowuję drzwi z katalogu…', icon: ScanSearch },
]

function LoadingStages({ stage }: { stage: SearchStage }) {
  const activeIdx = STAGES.findIndex((s) => s.key === stage)
  return (
    <div className="flex flex-col gap-4 py-20 pl-1">
      {STAGES.map(({ key, label, icon: Icon }, i) => {
        const isActive = i === activeIdx
        const isDone = i < activeIdx
        return (
          <div
            key={key}
            className={`flex items-center gap-2.5 text-[15px] transition-colors ${
              isActive
                ? 'text-brass-deep'
                : isDone
                  ? 'text-ink-soft line-through'
                  : 'text-ink-soft/40'
            }`}
          >
            {isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
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
}: SearchResultsProps) {
  if (appState === 'idle') return null

  if (appState === 'loading') {
    return <LoadingStages stage={searchStage} />
  }

  if (appState === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 py-20 pl-1">
        <AlertCircle className="h-7 w-7 text-red-500/80" />
        <p className="text-[15px] text-ink">Coś poszło nie tak. Spróbuj ponownie.</p>
        {errorMessage && <p className="max-w-md text-sm text-ink-soft">{errorMessage}</p>}
      </div>
    )
  }

  if (appState === 'empty-catalog') {
    return (
      <div className="flex flex-col items-start gap-3 py-20 pl-1">
        <PackageSearch className="h-7 w-7 text-ink-soft" />
        <p className="text-[15px] text-ink-soft">
          Katalog jest pusty. Zaimportuj feed produktowy, aby zacząć.
        </p>
      </div>
    )
  }

  if (!searchResult) return null

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="m-0 font-display text-[28px] font-normal text-ink">
          Drzwi dobrane do Twojego wnętrza
        </h1>
        <span className="text-[11px] uppercase tracking-[0.08em] text-ink-soft">
          {searchResult.products.length}{' '}
          {searchResult.products.length === 1
            ? 'propozycja'
            : searchResult.products.length < 5
              ? 'propozycje'
              : 'propozycji'}
        </span>
      </div>
      {appState === 'low-similarity' && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-brass/30 bg-brass-soft px-4 py-3 text-sm text-brass-deep">
          <SearchX className="h-4 w-4 flex-shrink-0" />
          Nie znaleźliśmy bardzo bliskiego dopasowania. Spróbuj innego zdjęcia lub doprecyzuj
          opis po lewej stronie.
        </div>
      )}
      <ResultsGrid products={searchResult.products} />
    </section>
  )
}
