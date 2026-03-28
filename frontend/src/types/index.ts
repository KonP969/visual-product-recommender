export interface Product {
  id: string
  name: string
  price: string
  imageUrl: string
  productUrl?: string
  similarity: number
}

export interface SearchResult {
  products: Product[]
  status: 'success' | 'empty-catalog' | 'low-similarity'
}

export interface ApiResponse<T> {
  data?: T
  error?: string
}

export type AppState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'empty-catalog'
  | 'low-similarity'

export interface FileValidationError {
  type: 'invalid-type' | 'too-large'
  message: string
}
