import { ApiResponse, SearchResult, SearchStage } from '@/types'

const BASE_URL = '/api'

interface ProgressEvent {
  type: 'progress'
  stage: SearchStage
}

interface ResultEvent {
  type: 'result'
  data: SearchResult
}

interface ErrorEvent {
  type: 'error'
  error: string
}

type SearchEvent = ProgressEvent | ResultEvent | ErrorEvent

// Reads the NDJSON stream from /api/search, reporting pipeline stages as they arrive.
export async function searchByImage(
  file: File,
  onStage?: (stage: SearchStage) => void,
): Promise<ApiResponse<SearchResult>> {
  const formData = new FormData()
  formData.append('image', file)

  try {
    const response = await fetch(`${BASE_URL}/search`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      return { error: error.error ?? 'Błąd serwera' }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const handleEvent = (event: SearchEvent): ApiResponse<SearchResult> | null => {
      if (event.type === 'progress') {
        onStage?.(event.stage)
        return null
      }
      if (event.type === 'result') return { data: event.data }
      return { error: event.error }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: true })

      let newlineIdx
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) continue
        const outcome = handleEvent(JSON.parse(line) as SearchEvent)
        if (outcome) return outcome
      }

      if (done) break
    }

    return { error: 'Serwer zakończył odpowiedź bez wyniku' }
  } catch {
    return { error: 'Błąd sieci. Czy backend jest uruchomiony?' }
  }
}

export async function searchByText(query: string): Promise<ApiResponse<SearchResult>> {
  try {
    const response = await fetch(`${BASE_URL}/search-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      return { error: error.error ?? 'Błąd serwera' }
    }

    const data = await response.json()
    return { data }
  } catch {
    return { error: 'Błąd sieci. Czy backend jest uruchomiony?' }
  }
}

export async function getCatalogStats(): Promise<ApiResponse<{ count: number }>> {
  try {
    const response = await fetch(`${BASE_URL}/catalog/stats`)
    if (!response.ok) return { error: 'Failed to fetch stats' }
    const data = await response.json()
    return { data }
  } catch {
    return { error: 'Network error' }
  }
}
