import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { stylesForModel, stylesForModelName } from '../styleResolver'
import { czytajTabele } from '../overrides'

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

  // docs/otwarte-zadania.md §2: skandynawski dochodzi z pary (opis, color_family)
  // per wariant — colorFamilies to równoległa tablica, po jednej wartości na opis.
  it('kolor wariantów wpływa na głosowanie — jasne drewno + minimalistyczny daje skandynawski', () => {
    const opisy = [
      'modern minimalist flat panel residential interior door',
      'modern minimalist flat panel residential interior door',
      'modern residential interior door',
    ]
    const kolory: Array<'light_wood' | 'grey'> = ['light_wood', 'light_wood', 'grey']
    expect(stylesForModel(opisy, kolory)).toEqual(['nowoczesny', 'minimalistyczny', 'skandynawski'])
  })

  it('bez tablicy kolorów (stare wywołanie) skandynawski z koloru nie dochodzi', () => {
    const opisy = [
      'modern minimalist flat panel residential interior door',
      'modern minimalist flat panel residential interior door',
    ]
    expect(stylesForModel(opisy)).toEqual(['nowoczesny', 'minimalistyczny'])
  })
})

describe('stylesForModelName — korekta przebija głosowanie', () => {
  // Ta funkcja czyta docs/style-overrides.json, czyli plik, który ekspert domenowy
  // katalogu edytuje. Testy MUSZĄ być odporne na jego treść — nazwa modelu
  // wpisana na sztywno prędzej czy później trafi do tabeli i wywróci test.
  const opisy = [
    'modern residential interior door light oak',
    'modern residential interior door white',
    'classic raised panel residential door',
  ]

  it('bez wpisu w tabeli zachowuje się jak stylesForModel', () => {
    expect(stylesForModelName('ATRAPA TESTOWA model 0', opisy)).toEqual(stylesForModel(opisy))
  })

  it('wpis z tabeli ZASTĘPUJE głosowanie, choćby opisy mówiły co innego', () => {
    const tabela = czytajTabele(
      JSON.parse(readFileSync(join(process.cwd(), '..', 'docs', 'style-overrides.json'), 'utf-8')),
    )
    const kolekcja = Object.keys(tabela.kolekcje)[0]
    if (!kolekcja) return // pusta tabela — nie ma czego sprawdzać
    const oczekiwany = tabela.kolekcje[kolekcja].style
    expect(stylesForModelName(`${kolekcja} model TEST`, opisy)).toEqual(oczekiwany)
  })
})
