import type { Product } from '@/types'
import { ProductCard } from './ProductCard'

interface ResultsGridProps {
  products: Product[]
}

export function ResultsGrid({ products }: ResultsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-5 animate-in fade-in duration-500 sm:grid-cols-3">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
