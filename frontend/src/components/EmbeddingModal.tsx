import { useEffect, useRef, useState } from 'react'
import { X, Loader2, ExternalLink } from 'lucide-react'

interface EmbeddingData {
  metadata: {
    name: string
    price: string
    imageUrl: string
    productUrl?: string
  }
  embedding: number[]
}

interface Props {
  productId: string
  onClose: () => void
}

// Mapuje wartość z zakresu [min, max] na kolor RGB: niebieski→biały→czerwony
function valueToColor(value: number, min: number, max: number): string {
  const t = (value - min) / (max - min) // 0..1
  if (t < 0.5) {
    // niebieski → biały
    const s = t * 2
    const r = Math.round(s * 255)
    const g = Math.round(s * 255)
    const b = 255
    return `rgb(${r},${g},${b})`
  } else {
    // biały → czerwony
    const s = (t - 0.5) * 2
    const r = 255
    const g = Math.round((1 - s) * 255)
    const b = Math.round((1 - s) * 255)
    return `rgb(${r},${g},${b})`
  }
}

function EmbeddingHeatmap({ embedding }: { embedding: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const COLS = 32
  const ROWS = 16 // 32×16 = 512
  const CELL = 14

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const min = Math.min(...embedding)
    const max = Math.max(...embedding)

    embedding.forEach((val, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      ctx.fillStyle = valueToColor(val, min, max)
      ctx.fillRect(col * CELL, row * CELL, CELL - 1, CELL - 1)
    })
  }, [embedding])

  return (
    <canvas
      ref={canvasRef}
      width={COLS * CELL}
      height={ROWS * CELL}
      className="rounded border border-gray-100"
    />
  )
}

function EmbeddingStats({ embedding }: { embedding: number[] }) {
  const min = Math.min(...embedding)
  const max = Math.max(...embedding)
  const mean = embedding.reduce((a, b) => a + b, 0) / embedding.length
  const variance = embedding.reduce((a, b) => a + (b - mean) ** 2, 0) / embedding.length
  const std = Math.sqrt(variance)
  const nonZero = embedding.filter((v) => Math.abs(v) > 0.001).length

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-4 py-3 text-xs">
      {[
        ['Wymiar', '512'],
        ['Min', min.toFixed(4)],
        ['Max', max.toFixed(4)],
        ['Średnia', mean.toFixed(4)],
        ['Std', std.toFixed(4)],
        ['Niezerowe', `${nonZero}/512`],
      ].map(([label, val]) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="text-gray-500">{label}</span>
          <span className="font-mono font-medium text-gray-800">{val}</span>
        </div>
      ))}
    </div>
  )
}

export function EmbeddingModal({ productId, onClose }: Props) {
  const [data, setData] = useState<EmbeddingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/catalog/embedding/${productId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError('Nie można załadować embeddingu'))
      .finally(() => setLoading(false))
  }, [productId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        )}

        {error && <p className="p-6 text-sm text-red-500">{error}</p>}

        {data && (
          <div className="flex flex-col gap-4 p-5">
            {/* Produkt */}
            <div className="flex gap-3">
              <img
                src={data.metadata.imageUrl}
                alt={data.metadata.name}
                className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
              />
              <div className="flex flex-col justify-center gap-1">
                <p className="text-sm font-medium leading-snug text-gray-800">
                  {data.metadata.name}
                </p>
                <p className="text-xs text-gray-500">{data.metadata.price} zł</p>
                {data.metadata.productUrl && (
                  <a
                    href={data.metadata.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Zobacz produkt
                  </a>
                )}
              </div>
            </div>

            {/* Heatmapa */}
            <div>
              <p className="mb-2 text-xs font-medium text-gray-600">
                Embedding CLIP — heatmapa 32×16 (512 wymiarów)
              </p>
              <EmbeddingHeatmap embedding={data.embedding} />
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-400" />
                  ujemne
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white border border-gray-200" />
                  zero
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />
                  dodatnie
                </span>
              </div>
            </div>

            {/* Statystyki */}
            <div>
              <p className="mb-2 text-xs font-medium text-gray-600">Statystyki</p>
              <EmbeddingStats embedding={data.embedding} />
            </div>

            {/* Pierwsze 8 wartości */}
            <div>
              <p className="mb-2 text-xs font-medium text-gray-600">Pierwsze 8 wartości</p>
              <div className="flex flex-wrap gap-1">
                {data.embedding.slice(0, 8).map((v, i) => (
                  <span
                    key={i}
                    className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[10px] text-gray-600"
                  >
                    [{i}] {v.toFixed(5)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
