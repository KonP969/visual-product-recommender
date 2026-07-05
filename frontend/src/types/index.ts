export interface Product {
  id: string
  name: string
  price: string
  imageUrl: string
  productUrl?: string
  similarity: number
  description?: string
  /** Polskie uzasadnienie dopasowania — dociera osobnym eventem po wynikach */
  why?: string
}

export interface SearchResult {
  products: Product[]
  description?: string
  displayDescription?: string
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

export type SearchStage = 'analyzing' | 'matching'

export interface FileValidationError {
  type: 'invalid-type' | 'too-large'
  message: string
}
