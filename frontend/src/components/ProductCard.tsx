import { useState } from 'react'
import type { Product } from '@/types'

interface ProductCardProps {
  product: Product
}

// Text↔text CLIP similarities cluster in 0.90–0.96, so a percentage reads as
// false precision — coarse labels communicate match quality more honestly.
function matchLabel(similarity: number): { text: string; dotClass: string; textClass: string } {
  if (similarity >= 0.93) {
    return { text: 'świetne dopasowanie', dotClass: 'bg-good', textClass: 'text-ink' }
  }
  return { text: 'podobny styl', dotClass: 'bg-[#B4AC9C]', textClass: 'text-ink-soft' }
}

function formatPrice(price: string): string {
  const value = Number(price)
  if (Number.isNaN(value)) return price
  return value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ProductCard({ product }: ProductCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const label = matchLabel(product.similarity)
  // Feed names follow "PORTA LINE model H.1 czarne intarsje - Czarny Struktura":
  // the part after " - " is the finish/colour variant (sometimes empty).
  const [rawTitle, variant] = product.name.split(' - ')
  const title = rawTitle.replace(/\s*-\s*$/, '').trim()

  const content = (
    <article className="group flex h-full flex-col gap-2.5">
      <div className="relative flex aspect-[3/4] items-end justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-panel to-[#EAE4D9] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_20px_34px_-22px_rgba(38,34,28,0.5)] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        {!imageLoaded && (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-end justify-center motion-reduce:animate-none"
          >
            {/* door-shaped shimmer while the Porta CDN packshot loads */}
            <div className="h-[82%] w-[46%] animate-pulse rounded-t-[3px] bg-linen/70" />
          </div>
        )}
        <img
          src={product.imageUrl}
          alt={product.name}
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
          className={`h-full w-full object-contain p-4 pb-0 transition-opacity duration-300 motion-reduce:transition-none ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] uppercase tracking-[0.1em]">
          <span className={`h-1.5 w-1.5 rounded-full ${label.dotClass}`} />
          <span className={label.textClass}>{label.text}</span>
        </span>
        {product.why && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 via-ink/60 to-transparent p-3 pt-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none">
            <p className="m-0 text-[12.5px] leading-relaxed text-paper">{product.why}</p>
          </div>
        )}
      </div>
      <h2 className="m-0 line-clamp-2 text-[14px] font-semibold leading-snug text-ink">
        {title}
      </h2>
      {variant && <p className="-mt-1.5 m-0 text-[13px] text-ink-soft">{variant}</p>}
      <div className="mt-auto flex items-baseline justify-between gap-2">
        <span className="font-display text-[16px] text-ink [font-variant-numeric:tabular-nums]">
          {formatPrice(product.price)} zł{' '}
          <small className="font-sans text-[10px] uppercase tracking-[0.05em] text-ink-soft">
            od
          </small>
        </span>
        {product.productUrl && (
          <span className="whitespace-nowrap border-b border-current text-[13px] text-brass transition-colors group-hover:text-brass-deep">
            konfigurator →
          </span>
        )}
      </div>
    </article>
  )

  if (product.productUrl) {
    return (
      <a
        href={product.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      >
        {content}
      </a>
    )
  }

  return content
}
