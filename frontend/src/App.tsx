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
  const { appState, searchResult, search } = useSearch()

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
            Find products by photo
          </h1>
          <p className="text-sm text-gray-500">
            Upload any image and discover visually similar products
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
              Search
            </button>
          )}
        </div>
        <SearchResults appState={appState} searchResult={searchResult} />
        <div className="flex flex-col items-center gap-4">
          <ImportPanel />
          <CatalogBrowser />
        </div>
      </main>
      <Footer />
    </div>
  )
}
