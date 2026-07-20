import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Settings } from 'lucide-react'
import { useFileUpload } from '@/hooks/useFileUpload'
import { useSearch } from '@/hooks/useSearch'
import { useRefinement } from '@/hooks/useRefinement'
import type { Grupa } from '@/lib/refinement'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { DropZone } from '@/components/DropZone'
import { Rail } from '@/components/Rail'
import { SearchResults } from '@/components/SearchResults'
import { ImportPanel } from '@/components/ImportPanel'
import { CatalogBrowser } from '@/components/CatalogBrowser'

const SAMPLES = [
  { src: '/samples/nowoczesny-salon.jpg', label: 'nowoczesny salon' },
  { src: '/samples/jasna-sypialnia.jpg', label: 'jasne wnętrze' },
  { src: '/samples/klasyczny-salon.jpg', label: 'klasyczny salon' },
]

export default function App() {
  const { previewUrl, validationError, handleFile, reset: resetFile } = useFileUpload()
  const { appState, searchStage, searchResult, errorMessage, search, refine, reset: resetSearch } = useSearch()
  const [showAdmin, setShowAdmin] = useState(false)

  const refinement = useRefinement()

  // Baza = displayPl PIERWSZEGO wyniku. ustawBazę zamraża po pierwszym ustawieniu,
  // więc kolejne (tekstowe) wyniki jej nie nadpisują — tu ginie dryf.
  const { ustawBazę } = refinement
  useEffect(() => {
    const pl = searchResult?.displayDescription
    if (pl) ustawBazę(pl)
  }, [searchResult, ustawBazę])

  const handleChip = (etykieta: string, grupa: Grupa) => {
    const q = refinement.chip(etykieta, grupa)
    refine(q, refinement.stylTeraz())
  }
  const handleText = (text: string) => {
    const q = refinement.tekst(text)
    refine(q, refinement.stylTeraz())
  }
  const handleRemove = (index: number) => {
    const q = refinement.usuń(index)
    refine(q, refinement.stylTeraz())
  }
  const handleUndo = () => {
    const q = refinement.cofnijKrok()
    refine(q, refinement.stylTeraz())
  }

  const handleReset = () => {
    refinement.zeruj()
    resetFile()
    resetSearch()
  }

  const handleFileSelected = (newFile: File) => {
    if (handleFile(newFile)) {
      search(newFile)
    }
  }

  const handleSample = async (sample: (typeof SAMPLES)[number]) => {
    const response = await fetch(sample.src)
    const blob = await response.blob()
    handleFileSelected(
      new File([blob], sample.src.split('/').pop() ?? 'sample.jpg', {
        type: blob.type || 'image/jpeg',
      }),
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10 lg:px-10">
        {!previewUrl ? (
          <>
            <div className="flex flex-col items-center gap-3 pt-8 text-center">
              <h1 className="font-display text-[34px] font-normal tracking-[0.005em] text-ink [text-wrap:balance]">
                Dobierz drzwi do swojego wnętrza
              </h1>
              <p className="max-w-md text-[15px] text-ink-soft">
                Wgraj zdjęcie pokoju, a zaproponujemy drzwi z katalogu Porta dopasowane
                kolorem i stylem
              </p>
            </div>
            <div className="flex flex-col items-center gap-8">
              <DropZone
                previewUrl={null}
                validationError={validationError}
                onFile={handleFileSelected}
              />
              <div className="flex flex-col items-center gap-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-ink-soft">
                  albo wypróbuj z przykładem
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {SAMPLES.map((sample) => (
                    <button
                      key={sample.src}
                      type="button"
                      onClick={() => handleSample(sample)}
                      className="group flex flex-col items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                    >
                      <img
                        src={sample.src}
                        alt={`Przykładowe wnętrze: ${sample.label}`}
                        className="h-20 w-28 rounded-xl object-cover shadow-sm ring-1 ring-linen transition-all group-hover:-translate-y-0.5 group-hover:ring-brass motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
                      />
                      <span className="text-xs text-ink-soft group-hover:text-brass-deep">
                        {sample.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="grid items-start gap-10 lg:grid-cols-[360px_1fr] lg:gap-12">
            <Rail
              previewUrl={previewUrl}
              baza={refinement.stan.baza}
              kroki={refinement.stan.kroki}
              busy={appState === 'loading'}
              validationError={validationError}
              onFile={handleFileSelected}
              onChip={handleChip}
              onText={handleText}
              onRemove={handleRemove}
              onUndo={handleUndo}
              onReset={handleReset}
            />
            <SearchResults
              appState={appState}
              searchStage={searchStage}
              searchResult={searchResult}
              errorMessage={errorMessage}
            />
          </div>
        )}

        <div className="mt-auto flex flex-col items-center gap-4 border-t border-linen pt-6">
          <button
            onClick={() => setShowAdmin((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-ink-soft/70 transition-colors hover:text-ink-soft"
          >
            <Settings className="h-3.5 w-3.5" />
            Panel administratora
            {showAdmin ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {showAdmin && (
            <div className="flex w-full flex-col items-center gap-4">
              <ImportPanel />
              <CatalogBrowser />
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
