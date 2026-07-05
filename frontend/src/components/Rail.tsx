import { useRef, useState, FormEvent, ChangeEvent } from 'react'
import { FileValidationError } from '@/types'

interface RailProps {
  previewUrl: string
  displayDescription: string | null
  busy: boolean
  validationError: FileValidationError | null
  onFile: (file: File) => void
  onRefine: (query: string) => void
}

const CHIPS = [
  'jaśniejsze',
  'ciemniejsze',
  'ze szkłem',
  'bez przeszklenia',
  'drewno naturalne',
  'klasyczne',
]

export function Rail({
  previewUrl,
  displayDescription,
  busy,
  validationError,
  onFile,
  onRefine,
}: RailProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [refineQuery, setRefineQuery] = useState('')

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }

  const handleChip = (chip: string) => {
    onRefine(displayDescription ? `${displayDescription}, ale ${chip}` : chip)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const q = refineQuery.trim()
    if (q) {
      onRefine(q)
      setRefineQuery('')
    }
  }

  return (
    <aside className="flex flex-col gap-6 lg:sticky lg:top-6">
      <figure className="m-0 overflow-hidden rounded-2xl shadow-[0_18px_40px_-24px_rgba(38,34,28,0.45)]">
        <img
          src={previewUrl}
          alt="Twoje wnętrze"
          className="aspect-[4/3] w-full object-cover"
        />
        <figcaption className="flex items-center justify-between bg-white px-4 py-2.5 text-[11px] uppercase tracking-[0.08em] text-ink-soft">
          Twoje wnętrze
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="border-b border-current text-brass transition-colors hover:text-brass-deep"
          >
            wgraj inne zdjęcie
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleInputChange}
          />
        </figcaption>
      </figure>
      {validationError && <p className="text-sm text-red-600">{validationError.message}</p>}

      {displayDescription && (
        <div className="border-l-[3px] border-brass pl-4">
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-ink-soft">
            Nasza rekomendacja stylu
          </p>
          <blockquote className="m-0 font-display text-[21px] italic leading-snug text-ink [text-wrap:balance]">
            {displayDescription}
          </blockquote>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Doprecyzuj wyszukiwanie">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={busy}
            onClick={() => handleChip(chip)}
            className="rounded-full border border-linen bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brass hover:bg-brass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40"
          >
            {chip}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={refineQuery}
          onChange={(e) => setRefineQuery(e.target.value)}
          placeholder="albo opisz własnymi słowami…"
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl border border-linen bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !refineQuery.trim()}
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-[#3A342C] disabled:opacity-40"
        >
          Szukaj
        </button>
      </form>
    </aside>
  )
}
