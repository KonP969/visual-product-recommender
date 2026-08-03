import { describe, it, expect, vi, beforeEach } from 'vitest'
import { countStylesIn, countStyles, invalidateStyleIndex } from '../styleIndex'
import type { WierszIndeksu } from '../styleIndex'

const KATALOG: WierszIndeksu[] = [
  { name: 'PORTA A model 1 - Biały', colorFamily: 'white', hasGlass: false, styles: ['klasyczny'] },
  { name: 'PORTA A model 1 - Dąb Ciemny', colorFamily: 'dark_wood', hasGlass: false, styles: ['klasyczny'] },
  { name: 'PORTA B model 2 z szybą - Biały', colorFamily: 'white', hasGlass: true, styles: ['nowoczesny', 'minimalistyczny'] },
  { name: 'NATURA VERDINO model V.1 - Orzech Ciemny', colorFamily: 'dark_wood', hasGlass: false, styles: ['rustykalny'] },
  { name: 'PORTA C model 3 - Biały', colorFamily: 'white', hasGlass: false, styles: [] },
]

describe('countStylesIn', () => {
  it('bez filtrów liczy cały katalog', () => {
    const c = countStylesIn(KATALOG)
    expect(c.klasyczny).toBe(2)
    expect(c.nowoczesny).toBe(1)
    expect(c.minimalistyczny).toBe(1)
    expect(c.rustykalny).toBe(1)
    expect(c.loft).toBe(0)
  })

  it('drzwi bezstylowe nie liczą się do żadnego stylu', () => {
    const c = countStylesIn([KATALOG[4]])
    expect(Object.values(c).every((n) => n === 0)).toBe(true)
  })

  it('filtr koloru zawęża liczby', () => {
    const c = countStylesIn(KATALOG, { colors: ['white'] })
    expect(c.klasyczny).toBe(1)
    expect(c.rustykalny).toBe(0) // brak białych rustykalnych — chip do wygaszenia
  })

  it('filtr szkła zawęża liczby', () => {
    const c = countStylesIn(KATALOG, { glass: true })
    expect(c.nowoczesny).toBe(1)
    expect(c.klasyczny).toBe(0)
  })

  it('filtr wybarwienia działa po nazwie wariantu', () => {
    const c = countStylesIn(KATALOG, { finish: 'orzech' })
    expect(c.rustykalny).toBe(1)
    expect(c.klasyczny).toBe(0)
  })

  it('filtr stylu jest ignorowany — liczymy przekrój BEZ niego', () => {
    const c = countStylesIn(KATALOG, { style: 'loft' })
    expect(c.klasyczny).toBe(2)
  })

  // F7: gałęzie bez asercji dotąd — błąd w warunku szkła po cichu zmieniłby
  // KAŻDY licznik (glass === false to realny, częsty filtr z chipa "bez
  // przeszklenia"), a colors: [] (np. z frontu po wyczyszczeniu multiselecta)
  // musi zachowywać się jak brak filtra, nie jak "żaden kolor nie pasuje".
  it('filtr glass:false liczy TYLKO bezszybowe (nie "brak filtra")', () => {
    const c = countStylesIn(KATALOG, { glass: false })
    expect(c.klasyczny).toBe(2) // oba klasyczne warianty są bez szyby
    expect(c.rustykalny).toBe(1)
    expect(c.nowoczesny).toBe(0) // jedyny nowoczesny wariant MA szybę
    expect(c.minimalistyczny).toBe(0)
  })

  it('colors: [] (pusta tablica) zachowuje się jak brak filtra koloru', () => {
    const c = countStylesIn(KATALOG, { colors: [] })
    expect(c).toEqual(countStylesIn(KATALOG))
  })
})

// F4: getIndeks trzymał TABLICĘ, nie OBIETNICĘ — dwa wyszukiwania w oknie
// zimnego startu (ts-node-dev --respawn restartuje backend po każdej edycji)
// robiły pełny skan każde. Mockujemy 'chromadb', żeby policzyć realne
// zapytania do Chromy bez sieci.
const colGet = vi.fn()
const getCollection = vi.fn().mockResolvedValue({ get: colGet })
vi.mock('chromadb', () => ({
  ChromaClient: vi.fn().mockImplementation(() => ({ getCollection })),
}))

describe('getIndeks (przez countStyles) — zimny start bez duplikacji skanu', () => {
  beforeEach(async () => {
    const { invalidateStyleIndex } = await import('../styleIndex')
    invalidateStyleIndex()
    colGet.mockReset().mockResolvedValue({ ids: [], metadatas: [] })
    getCollection.mockClear()
  })

  it('dwa równoległe countStyles() w oknie zimnego startu dzielą JEDEN skan', async () => {
    const { countStyles } = await import('../styleIndex')
    await Promise.all([countStyles(), countStyles()])
    expect(getCollection).toHaveBeenCalledTimes(1)
    expect(colGet).toHaveBeenCalledTimes(1)
  })

  it('po zbudowaniu indeksu kolejne countStyles() NIE odpytują już Chromy (ciepły indeks)', async () => {
    const { countStyles } = await import('../styleIndex')
    await countStyles()
    await countStyles()
    expect(colGet).toHaveBeenCalledTimes(1)
  })

  it('invalidateStyleIndex czyści też obietnicę budowy — kolejne wywołanie skanuje od nowa', async () => {
    const { countStyles, invalidateStyleIndex } = await import('../styleIndex')
    await countStyles()
    expect(colGet).toHaveBeenCalledTimes(1)
    invalidateStyleIndex()
    await countStyles()
    expect(colGet).toHaveBeenCalledTimes(2)
  })
})
