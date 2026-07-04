import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings } from 'lucide-react'
import { useFileUpload } from '@/hooks/useFileUpload'
import { useSearch } from '@/hooks/useSearch'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { DropZone } from '@/components/DropZone'
import { SearchResults } from '@/components/SearchResults'
import { ImportPanel } from '@/components/ImportPanel'
import { CatalogBrowser } from '@/components/CatalogBrowser'

export default function App() {
  const { file, previewUrl, validationError, handleFile } = useFileUpload()
  const { appState, searchStage, searchResult, errorMessage, search, refine } = useSearch()
  const [showAdmin, setShowAdmin] = useState(false)

  const handleFileSelected = (newFile: File) => {
    handleFile(newFile)
    if (!validationError) {
      search(newFile)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Dobierz drzwi do swojego wnętrza
          </h1>
          <p className="text-sm text-gray-500">
            Wgraj zdjęcie pokoju, a my zaproponujemy pasujące drzwi z katalogu
          </p>
        </div>
        <div className="flex flex-col items-center gap-8">
          <DropZone
            previewUrl={previewUrl}
            validationError={validationError}
            onFile={handleFileSelected}
          />
          {file && appState === 'idle' && (
            <button
              onClick={() => search(file)}
              className="rounded-full bg-blue-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              Szukaj
            </button>
          )}
        </div>
        <SearchResults
          appState={appState}
          searchStage={searchStage}
          searchResult={searchResult}
          errorMessage={errorMessage}
          onRefine={refine}
        />
        <div className="mt-auto flex flex-col items-center gap-4 border-t border-gray-100 pt-6">
          <button
            onClick={() => setShowAdmin((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600"
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
