import type { ApiResponse, SearchResult, SearchStage } from '@/types'

const BASE_URL = '/api'

type SearchEvent =
  | { type: 'progress'; stage: SearchStage }
  | { type: 'result'; data: SearchResult }
  | { type: 'reasons'; data: Record<string, string> }
  | { type: 'error'; error: string }

export interface SearchStreamHandlers {
  onStage?: (stage: SearchStage) => void
  /** Wyniki — wywoływane od razu, zanim stream się skończy */
  onResult?: (result: SearchResult) => void
  /** Uzasadnienia dopasowań per produkt (id → why), dociera po wynikach */
  onReasons?: (reasons: Record<string, string>) => void
}

// Reads the NDJSON search stream. Results are delivered early via onResult;
// the returned promise resolves when the stream ends (after optional reasons).
async function consumeSearchStream(
  response: globalThis.Response,
  handlers: SearchStreamHandlers,
): Promise<ApiResponse<SearchResult>> {
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    return { error: error.error ?? 'Błąd serwera' }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: SearchResult | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })

    let newlineIdx
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim()
      buffer = buffer.slice(newlineIdx + 1)
      if (!line) continue

      const event = JSON.parse(line) as SearchEvent
      if (event.type === 'progress') {
        handlers.onStage?.(event.stage)
      } else if (event.type === 'result') {
        result = event.data
        handlers.onResult?.(event.data)
      } else if (event.type === 'reasons') {
        handlers.onReasons?.(event.data)
      } else if (event.type === 'error') {
        return { error: event.error }
      }
    }

    if (done) break
  }

  return result ? { data: result } : { error: 'Serwer zakończył odpowiedź bez wyniku' }
}

export interface SearchPagingOptions {
  /** "Doładuj kolejne": nazwy już pokazanych produktów, żeby się nie powtórzyły */
  excludeNames?: string[]
  /** Ile nowych produktów zwrócić (domyślnie 10 po stronie backendu) */
  n?: number
}

export async function searchByImage(
  file: File,
  opts: SearchPagingOptions = {},
  handlers: SearchStreamHandlers = {},
): Promise<ApiResponse<SearchResult>> {
  const formData = new FormData()
  formData.append('image', file)
  if (opts.excludeNames?.length) formData.append('excludeNames', JSON.stringify(opts.excludeNames))
  if (opts.n) formData.append('n', String(opts.n))

  try {
    const response = await fetch(`${BASE_URL}/search`, {
      method: 'POST',
      body: formData,
    })
    return await consumeSearchStream(response, handlers)
  } catch {
    return { error: 'Błąd sieci. Czy backend jest uruchomiony?' }
  }
}

export async function searchByText(
  query: string,
  opts: { style?: string | null; refinement?: string } & SearchPagingOptions = {},
  handlers: SearchStreamHandlers = {},
): Promise<ApiResponse<SearchResult>> {
  try {
    const response = await fetch(`${BASE_URL}/search-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        style: opts.style ?? null,
        refinement: opts.refinement ?? null,
        excludeNames: opts.excludeNames,
        n: opts.n,
      }),
    })
    return await consumeSearchStream(response, handlers)
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
