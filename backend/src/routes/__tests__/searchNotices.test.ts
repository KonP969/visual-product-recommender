import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildNotice, buildEmptyResultNotice, decydujOStylu, resolveStyleFilter } from '../searchNotices'
import type { HardFilters } from '../../services/chromaService'

vi.mock('../../services/styleIndex', () => ({
  countStyles: vi.fn(),
}))
import { countStyles } from '../../services/styleIndex'

describe('buildNotice', () => {
  it('brak pominiętych filtrów → brak komunikatu', () => {
    expect(buildNotice()).toBeUndefined()
  })

  it('pominięte wybarwienie', () => {
    const n = buildNotice('orzech')
    expect(n).toContain('orzech')
    expect(n).toContain('zbliżone kolorystycznie')
  })

  it('pominięty styl', () => {
    const n = buildNotice(undefined, 'rustykalny')
    expect(n).toContain('rustykalnym')
    expect(n).toContain('bez filtra stylu')
  })

  it('oba pominięte → dwa zdania w jednym polu', () => {
    const n = buildNotice('dab', 'loft')!
    expect(n).toContain('dąb')
    expect(n).toContain('loftowym')
    expect(n.split('—').length).toBeGreaterThan(2)
  })

  it('nieznany klucz stylu nie wywraca komunikatu', () => {
    expect(buildNotice(undefined, 'nieznany')).toContain('nieznany')
  })
})

// Bug: "dopisz własnymi słowami" → "drzwi czarne" przy pustej puli twardego
// filtra koloru wracało z generycznym "Katalog jest pusty. Zaimportuj feed..."
// (tekst dla NAPRAWDĘ pustej bazy) — mylące, bo katalog ma tysiące produktów,
// po prostu żaden nie pasuje do TEGO koloru. Zero wyników z twardego filtra
// (kolor/szkło/styl — nienegocjowalne, patrz chromaService.searchSimilar)
// potrzebuje własnego, konkretnego zdania.
describe('buildEmptyResultNotice', () => {
  it('brak filtrów → brak komunikatu (prawdziwie pusty katalog)', () => {
    expect(buildEmptyResultNotice()).toBeUndefined()
    expect(buildEmptyResultNotice({})).toBeUndefined()
  })

  it('twardy filtr koloru → konkretne zdanie z nazwą koloru po polsku', () => {
    const n = buildEmptyResultNotice({ colors: ['black'] })
    expect(n).toContain('czarnym')
    expect(n).not.toContain('Zaimportuj')
  })

  it('łączy kolor, szkło i styl w jednym zdaniu', () => {
    const n = buildEmptyResultNotice({ colors: ['white'], glass: true, style: 'loft' })
    expect(n).toContain('białym')
    expect(n).toContain('ze szkłem')
    expect(n).toContain('loftowym')
  })
})

// F1/F5: liczniki per styl liczą ŚCISŁE trafienia (patrz styleIndex), a `finish`
// jest filtrem MIĘKKIM w chromaService (odrzucany po cichu, gdy pula jest pusta).
// Reguła decyzyjna o pominięciu stylu musi więc umieć rozróżnić „stylu naprawdę
// nie ma" od „finish akurat wyzerował całą pulę, w tym styl".
const ZERA: Record<string, number> = {
  klasyczny: 0,
  nowoczesny: 0,
  minimalistyczny: 0,
  rustykalny: 0,
  loft: 0,
  skandynawski: 0,
  glamour: 0,
}

describe('decydujOStylu — czysta reguła decyzyjna (bez sieci)', () => {
  it('liczniki dodatnie dla żądanego stylu → filtr stylu zostaje bez zmian', () => {
    const filters: HardFilters = { style: 'rustykalny' }
    const counts = { ...ZERA, rustykalny: 12 } as Record<string, number>
    const wynik = decydujOStylu(filters, counts as any, null)
    expect(wynik.filters).toEqual(filters)
    expect(wynik.droppedStyle).toBeUndefined()
    expect(wynik.styleCounts).toEqual(counts)
  })

  it('zero dla żądanego stylu, inne niezerowe, brak finish → filtr pomijany i droppedStyle ustawione', () => {
    const filters: HardFilters = { style: 'rustykalny' }
    const counts = { ...ZERA, klasyczny: 50 } as Record<string, number>
    const wynik = decydujOStylu(filters, counts as any, null)
    expect(wynik.droppedStyle).toBe('rustykalny')
    expect(wynik.filters?.style).toBeNull()
    expect(wynik.styleCounts).toEqual(counts)
  })

  it('wszystkie liczniki zerowe przy aktywnym finish, po przeliczeniu styl MA trafienia → NIE pomija', () => {
    const filters: HardFilters = { style: 'rustykalny', finish: 'buk' }
    const bezFinish = { ...ZERA, rustykalny: 97 } as Record<string, number>
    const wynik = decydujOStylu(filters, ZERA as any, bezFinish as any)
    expect(wynik.droppedStyle).toBeUndefined()
    expect(wynik.filters).toEqual(filters)
    expect(wynik.styleCounts).toEqual(bezFinish)
  })

  it('wszystkie liczniki zerowe przy aktywnym finish, po przeliczeniu WCIĄŻ zero → pomija, ale pokazuje przeliczone liczniki', () => {
    const filters: HardFilters = { style: 'glamour', finish: 'buk' }
    const bezFinish = { ...ZERA, rustykalny: 97 } as Record<string, number> // glamour nadal 0
    const wynik = decydujOStylu(filters, ZERA as any, bezFinish as any)
    expect(wynik.droppedStyle).toBe('glamour')
    expect(wynik.filters?.style).toBeNull()
    expect(wynik.styleCounts).toEqual(bezFinish)
  })

  it('brak żądanego stylu → liczniki i filtry bez zmian', () => {
    const wynik = decydujOStylu(undefined, { ...ZERA, klasyczny: 5 } as any, null)
    expect(wynik.droppedStyle).toBeUndefined()
    expect(wynik.filters).toBeUndefined()
  })
})

describe('resolveStyleFilter — orkiestracja (countStyles mockowany)', () => {
  beforeEach(() => {
    vi.mocked(countStyles).mockReset()
  })

  it('liczy raz, gdy styl ma trafienia od razu', async () => {
    vi.mocked(countStyles).mockResolvedValueOnce({ ...ZERA, rustykalny: 12 } as any)
    const wynik = await resolveStyleFilter({ style: 'rustykalny' })
    expect(countStyles).toHaveBeenCalledTimes(1)
    expect(wynik.droppedStyle).toBeUndefined()
    expect(wynik.filters?.style).toBe('rustykalny')
  })

  it('przelicza bez finish, gdy wszystkie liczniki wyszły zerowe z aktywnym finish — F1 repro', async () => {
    // Odtwarza dokładnie zgłoszenie z F1: "drzwi bukowe rustykalne" — buk nie
    // istnieje w katalogu, więc pierwsze liczenie (z finish='buk') zwraca same
    // zera. Drugie, bez finish, pokazuje prawdziwe 97 trafień rustykalnych.
    vi.mocked(countStyles)
      .mockResolvedValueOnce(ZERA as any)
      .mockResolvedValueOnce({ ...ZERA, rustykalny: 97 } as any)
    const wynik = await resolveStyleFilter({ style: 'rustykalny', finish: 'buk' })
    expect(countStyles).toHaveBeenCalledTimes(2)
    expect(countStyles).toHaveBeenLastCalledWith(expect.objectContaining({ finish: null }))
    expect(wynik.droppedStyle).toBeUndefined()
    expect(wynik.filters?.style).toBe('rustykalny')
    expect(wynik.styleCounts.rustykalny).toBe(97)
  })

  it('nie przelicza drugi raz, gdy finish nie jest ustawiony (zwykłe pominięcie stylu)', async () => {
    vi.mocked(countStyles).mockResolvedValueOnce(ZERA as any)
    const wynik = await resolveStyleFilter({ style: 'rustykalny' })
    expect(countStyles).toHaveBeenCalledTimes(1)
    expect(wynik.droppedStyle).toBe('rustykalny')
  })

  it('nie przelicza drugi raz, gdy tylko żądany styl jest zerowy, a inne nie (finish nie jest winny)', async () => {
    vi.mocked(countStyles).mockResolvedValueOnce({ ...ZERA, klasyczny: 30 } as any)
    const wynik = await resolveStyleFilter({ style: 'rustykalny', finish: 'buk' })
    expect(countStyles).toHaveBeenCalledTimes(1)
    expect(wynik.droppedStyle).toBe('rustykalny')
  })
})
