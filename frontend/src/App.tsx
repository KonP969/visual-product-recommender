import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings } from 'lucide-react'
import { useFileUpload } from '@/hooks/useFileUpload'
import { useSearch } from '@/hooks/useSearch'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { DropZone } from '@/components/DropZone'
import { Rail } from '@/components/Rail'
import { SearchResults } from '@/components/SearchResults'
import { ImportPanel } from '@/components/ImportPanel'
import { CatalogBrowser } from '@/components/CatalogBrowser'

export default function App() {
  const { previewUrl, validationError, handleFile } = useFileUpload()
  const { appState, searchStage, searchResult, errorMessage, search, refine } = useSearch()
  const [showAdmin, setShowAdmin] = useState(false)

  const handleFileSelected = (newFile: File) => {
    if (handleFile(newFile)) {
      search(newFile)
    }
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
            <div className="flex flex-col items-center">
              <DropZone
                previewUrl={null}
                validationError={validationError}
                onFile={handleFileSelected}
              />
            </div>
          </>
        ) : (
          <div className="grid items-start gap-10 lg:grid-cols-[360px_1fr] lg:gap-12">
            <Rail
              previewUrl={previewUrl}
              displayDescription={searchResult?.displayDescription ?? null}
              busy={appState === 'loading'}
              validationError={validationError}
              onFile={handleFileSelected}
              onRefine={refine}
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
