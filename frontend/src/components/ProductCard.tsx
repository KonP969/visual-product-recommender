import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Product } from '@/types'

interface ProductCardProps {
  product: Product
}

export function ProductCard({ product }: ProductCardProps) {
  const similarityPercent = Math.round(product.similarity * 100)

  const content = (
    <Card className="group overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-md">
      <div className="relative aspect-square overflow-hidden bg-gray-50">
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute right-2 top-2">
          <Badge variant="secondary" className="text-xs font-medium">
            {similarityPercent}%
          </Badge>
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-gray-900">{product.name}</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">{product.price}</span>
          {product.productUrl && (
            <ExternalLink className="h-3.5 w-3.5 text-gray-400 group-hover:text-blue-500" />
          )}
        </div>
      </div>
    </Card>
  )

  if (product.productUrl) {
    return (
      <a href={product.productUrl} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    )
  }

  return content
}
