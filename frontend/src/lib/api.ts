import { ApiResponse, SearchResult } from '@/types'

const BASE_URL = '/api'

export async function searchByImage(file: File): Promise<ApiResponse<SearchResult>> {
  const formData = new FormData()
  formData.append('image', file)

  try {
    const response = await fetch(`${BASE_URL}/search`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      return { error: error.error ?? 'Server error' }
    }

    const data = await response.json()
    return { data }
  } catch {
    return { error: 'Network error. Is the backend running?' }
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
