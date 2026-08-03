import { describe, it, expect } from 'vitest'
import { stylesForModel } from '../styleResolver'

describe('stylesForModel — opisy wariantów modelu → styl modelu', () => {
  it('większość opisów decyduje', () => {
    expect(
      stylesForModel([
        'modern residential interior door light oak',
        'modern residential interior door white',
        'classic raised panel residential door',
      ]),
    ).toEqual(['nowoczesny'])
  })

  it('pojedyncza wzmianka o rustic nie robi modelu rustykalnym', () => {
    const opisy = [
      'modern residential interior door light oak',
      'modern residential interior door natural oak',
      'modern design, honey acacia veneer, adding a rustic touch',
    ]
    expect(stylesForModel(opisy)).toEqual(['nowoczesny'])
  })

  it('model realnie rustykalny zostaje rustykalny', () => {
    const opisy = [
      'rustic knotty pine residential door',
      'rustic farmhouse style residential door',
      'rustic residential interior door',
    ]
    expect(stylesForModel(opisy)).toEqual(['rustykalny'])
  })

  it('opisy bez sygnału stylu → pusto', () => {
    expect(stylesForModel(['residential interior door', 'interior door white'])).toEqual([])
  })

  // F3: importService.ts nigdy nie zapisuje `description` (import z UI jest
  // obrazkowy) — takie warianty głosują [], ale wcześniej nadal liczyły się do
  // perVariant.length w aggregateStyles, rozwadniając mianownik. Dla modeli
  // WIELOETYKIETOWYCH to potrafiło zdjąć styl nadany przez backfill:
  // 3 warianty z opisem dają większość {nowoczesny, minimalistyczny}; dołożenie
  // 3 pustych (import UI) bez filtrowania psuje większość i minimalistyczny znika.
  it('puste opisy (import z UI, bez wizji) NIE rozwadniają głosowania modelu wieloetykietowego', () => {
    const zOpisem = [
      'modern minimalist residential interior door white',
      'modern minimalist residential interior door black',
      'modern residential interior door grey',
    ]
    const zPustymOpisem = ['', '', ''] // warianty z importu przez zdjęcie
    expect(stylesForModel([...zOpisem, ...zPustymOpisem])).toEqual(['nowoczesny', 'minimalistyczny'])
    // Kontrola: bez pustych opisów wynik jest identyczny — pokazuje, że to
    // one były przyczyną rozjazdu, a nie coś innego w regule głosowania.
    expect(stylesForModel(zOpisem)).toEqual(['nowoczesny', 'minimalistyczny'])
  })

  it('model, którego WSZYSTKIE warianty nie mają opisu → style_none (pusty wynik), nie awaria', () => {
    expect(stylesForModel(['', '  ', ''])).toEqual([])
  })
})
