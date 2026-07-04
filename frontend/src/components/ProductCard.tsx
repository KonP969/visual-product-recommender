import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Product } from '@/types'

interface ProductCardProps {
  product: Product
}

// Text↔text CLIP similarities cluster in 0.90–0.96, so a percentage reads as
// false precision — coarse labels communicate match quality more honestly.
function matchLabel(similarity: number): { text: string; className: string } {
  if (similarity >= 0.93) {
    return { text: 'Świetne dopasowanie', className: 'bg-emerald-100 text-emerald-700' }
  }
  return { text: 'Podobny styl', className: 'bg-gray-100 text-gray-600' }
}

export function ProductCard({ product }: ProductCardProps) {
  const label = matchLabel(product.similarity)

  const content = (
    <Card className="group overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-md">
      <div className="relative aspect-[3/4] overflow-hidden bg-gray-50">
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute right-2 top-2">
          <Badge variant="secondary" className={`text-xs font-medium ${label.className}`}>
            {label.text}
          </Badge>
        </div>
        {product.description && (
          <div className="absolute inset-0 flex items-end bg-black/60 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <p className="text-xs leading-relaxed text-white">{product.description}</p>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-gray-900">{product.name}</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">{product.price} zł</span>
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
