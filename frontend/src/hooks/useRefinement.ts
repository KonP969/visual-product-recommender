import { useCallback, useRef, useState } from 'react'
import type { StanZapytania, Grupa } from '@/lib/refinement'
import {
  stanPoczątkowy,
  dodajKrok,
  usuńKrok,
  cofnij,
  budujZapytanie,
  aktywnyStyl,
} from '@/lib/refinement'

export interface UseRefinementReturn {
  stan: StanZapytania
  ustawBazę: (baza: string) => void
  chip: (etykieta: string, grupa: Grupa) => string
  tekst: (etykieta: string) => string
  usuń: (index: number) => string
  cofnijKrok: () => string
  zeruj: () => void
  stylTeraz: () => string | null
}

// Cienka nakładka na czysty moduł refinement. Ref lustrzy najświeższy stan,
// żeby akcje mogły policzyć następny stan i ZWRÓCIĆ zapytanie natychmiast —
// event handlery w App odpalają refine() bez czekania na re-render Reacta.
export function useRefinement(): UseRefinementReturn {
  const [stan, setStan] = useState<StanZapytania>(() => stanPoczątkowy(null))
  const ref = useRef(stan)

  const commit = useCallback((next: StanZapytania): string => {
    ref.current = next
    setStan(next)
    return budujZapytanie(next)
  }, [])

  const ustawBazę = useCallback((baza: string) => {
    if (ref.current.baza !== null) return // zamrożenie: ustawiamy tylko raz
    const next = { ...ref.current, baza }
    ref.current = next
    setStan(next)
  }, [])

  const chip = useCallback(
    (etykieta: string, grupa: Grupa) => commit(dodajKrok(ref.current, etykieta, grupa)),
    [commit],
  )
  const tekst = useCallback(
    (etykieta: string) => commit(dodajKrok(ref.current, etykieta, 'własne')),
    [commit],
  )
  const usuń = useCallback((index: number) => commit(usuńKrok(ref.current, index)), [commit])
  const cofnijKrok = useCallback(() => commit(cofnij(ref.current)), [commit])

  const zeruj = useCallback(() => {
    const next = stanPoczątkowy(null)
    ref.current = next
    setStan(next)
  }, [])

  const stylTeraz = useCallback(() => aktywnyStyl(ref.current), [])

  return { stan, ustawBazę, chip, tekst, usuń, cofnijKrok, zeruj, stylTeraz }
}
