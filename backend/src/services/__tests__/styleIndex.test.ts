import { describe, it, expect } from 'vitest'
import { countStylesIn } from '../styleIndex'
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
})
