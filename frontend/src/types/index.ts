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
  /** cena najtańszego wariantu tej samej nazwy — gdy variantCount > 1 */
  priceFrom?: string
  /** liczba wariantów o tej samej nazwie (model+kolor) */
  variantCount?: number
}

export interface Wildcard {
  displayDescription: string
  why: string
  products: Product[]
}

export interface SearchResult {
  products: Product[]
  description?: string
  displayDescription?: string
  /** Odważna alternatywa projektanta (tylko wyszukiwanie ze zdjęcia) */
  wildcard?: Wildcard | null
  status: 'success' | 'empty-catalog' | 'low-similarity'
  /** Kryterium, którego nie dało się spełnić — mówimy o tym wprost, nie po cichu */
  notice?: string
  /** trafienia per styl przy obecnych filtrach — do liczb i wygaszania chipów */
  styleCounts?: Record<string, number>
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
