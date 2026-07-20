import { useRef, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { X, Undo2 } from 'lucide-react'
import type { FileValidationError } from '@/types'
import { CHIPY, czyAktywny } from '@/lib/refinement'
import type { Krok, Grupa, StanZapytania } from '@/lib/refinement'

interface RailProps {
  previewUrl: string
  baza: string | null
  kroki: Krok[]
  busy: boolean
  validationError: FileValidationError | null
  onFile: (file: File) => void
  onChip: (etykieta: string, grupa: Grupa) => void
  onText: (text: string) => void
  onRemove: (index: number) => void
  onUndo: () => void
  onReset: () => void
}

export function Rail({
  previewUrl,
  baza,
  kroki,
  busy,
  validationError,
  onFile,
  onChip,
  onText,
  onRemove,
  onUndo,
  onReset,
}: RailProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [tekst, setTekst] = useState('')

  const stan: StanZapytania = { baza, kroki }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const q = tekst.trim()
    if (q) {
      onText(q)
      setTekst('')
    }
  }

  return (
    <aside className="flex flex-col gap-6 lg:sticky lg:top-6">
      <div className="sr-only" aria-live="polite">
        {kroki.length > 0
          ? `Aktywne doprecyzowania: ${kroki.map((k) => k.etykieta).join(', ')}.`
          : 'Brak doprecyzowań.'}
      </div>
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

      {baza && (
        <div className="border-l-[3px] border-brass pl-4">
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-ink-soft">
            Nasza rekomendacja stylu
          </p>
          <blockquote className="m-0 font-display text-[21px] italic leading-snug text-ink [text-wrap:balance]">
            {baza}
          </blockquote>
        </div>
      )}

      {kroki.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.12em] text-ink-soft">
              Doprecyzowanie
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={onUndo}
              className="flex items-center gap-1 text-[11px] text-ink-soft/80 transition-colors hover:text-ink-soft disabled:opacity-40"
            >
              <Undo2 className="h-3 w-3" /> cofnij
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {kroki.map((k, i) => (
              <span
                key={`${k.grupa}-${k.etykieta}-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-brass-soft px-3 py-1.5 text-[13px] text-ink"
              >
                {k.etykieta}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Usuń: ${k.etykieta}`}
                  onClick={() => onRemove(i)}
                  className="text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Doprecyzuj wyszukiwanie">
        {CHIPY.filter((c) => c.grupa !== 'styl').map((chip) => {
          const aktywny = czyAktywny(stan, chip.etykieta, chip.grupa)
          return (
            <button
              key={chip.etykieta}
              type="button"
              disabled={busy}
              aria-pressed={aktywny}
              onClick={() => onChip(chip.etykieta, chip.grupa)}
              className={
                aktywny
                  ? 'rounded-full border border-brass bg-brass px-3.5 py-1.5 text-[13px] font-medium text-paper transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
                  : 'rounded-full border border-linen bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brass hover:bg-brass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
              }
            >
              {chip.etykieta}
            </button>
          )
        })}
      </div>

      <div role="group" aria-label="Styl">
        <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ink-soft">Styl</p>
        <div className="flex flex-wrap gap-2">
          {CHIPY.filter((c) => c.grupa === 'styl').map((chip) => {
            const aktywny = czyAktywny(stan, chip.etykieta, chip.grupa)
            return (
              <button
                key={chip.etykieta}
                type="button"
                disabled={busy}
                aria-pressed={aktywny}
                onClick={() => onChip(chip.etykieta, chip.grupa)}
                className={
                  aktywny
                    ? 'rounded-full border border-brass bg-brass px-3.5 py-1.5 text-[13px] font-medium text-paper transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
                    : 'rounded-full border border-linen bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brass hover:bg-brass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-40'
                }
              >
                {chip.etykieta}
              </button>
            )
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          placeholder="dopisz własnymi słowami…"
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl border border-linen bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !tekst.trim()}
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-[#3A342C] disabled:opacity-40"
        >
          Szukaj
        </button>
      </form>

      <button
        type="button"
        onClick={onReset}
        className="self-start text-xs text-ink-soft/70 underline decoration-linen underline-offset-2 transition-colors hover:text-ink-soft"
      >
        ← zacznij od nowa
      </button>
    </aside>
  )
}
