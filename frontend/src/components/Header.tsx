import { useEffect, useState } from 'react'
import { getCatalogStats } from '@/lib/api'

export function Header() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    getCatalogStats().then((res) => {
      if (res.data) setCount(res.data.count)
    })
  }, [])

  return (
    <header className="border-b border-linen bg-paper">
      <div className="mx-auto flex max-w-6xl items-baseline justify-between px-6 py-4 lg:px-10">
        <span className="font-display text-[19px] text-ink">
          Wizualny <em className="italic text-brass">Doradca</em> Drzwi
        </span>
        <span className="text-[11px] uppercase tracking-[0.08em] text-ink-soft">
          {/* `count` to liczba REKORDÓW w ChromaDB (wariant = model + kolor), nie modeli —
              modeli jest ~513. Podpis musi się zgadzać z tym, co faktycznie liczymy. */}
          {count !== null
            ? `Katalog · ${count.toLocaleString('pl-PL')} produktów`
            : 'Katalog'}
        </span>
      </div>
    </header>
  )
}
