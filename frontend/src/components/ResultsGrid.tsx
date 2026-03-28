import { Product } from '@/types'
import { ProductCard } from './ProductCard'

interface ResultsGridProps {
  products: Product[]
}

export function ResultsGrid({ products }: ResultsGridProps) {
  return (
    <div className="animate-in fade-in duration-500">
      <p className="mb-4 text-sm text-gray-500">
        {products.length} matching product{products.length !== 1 ? 's' : ''} found
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  )
}
