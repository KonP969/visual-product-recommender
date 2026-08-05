import { describe, it, expect } from 'vitest'
import { kolekcjaOf, czytajTabele, korektaZTabeli } from '../overrides'

describe('kolekcjaOf — nazwa modelu → nazwa kolekcji', () => {
  it.each([
    ['PORTA VIGO model V.3', 'PORTA VIGO'],
    ['NATURA CLASSIC model 7.1 z bulajem', 'NATURA CLASSIC'],
    ['PORTA VERTE PREMIUM model E.4', 'PORTA VERTE PREMIUM'],
    ['PORTA GLASS szyba grafitowa matowa', 'PORTA GLASS'],
    ['PORTA VECTOR PREMIUM Bulaj Szyba Matowa', 'PORTA VECTOR PREMIUM'],
    ['TRIM, model T0', 'TRIM'],
  ])('%s → %s', (model, oczekiwana) => {
    expect(kolekcjaOf(model)).toBe(oczekiwana)
  })
})

describe('czytajTabele — walidacja jest głośna', () => {
  it('poprawna tabela przechodzi', () => {
    const t = czytajTabele({
      kolekcje: { 'PORTA VIGO': { style: ['rustykalny'] } },
      modele: { 'PORTA VERTE PREMIUM model E.4': { has_glass: true } },
    })
    expect(t.kolekcje['PORTA VIGO'].style).toEqual(['rustykalny'])
    expect(t.modele['PORTA VERTE PREMIUM model E.4'].hasGlass).toBe(true)
  })

  it('pusta tabela jest poprawna', () => {
    expect(czytajTabele({ kolekcje: {}, modele: {} })).toEqual({ kolekcje: {}, modele: {} })
  })

  it('styl spoza listy → wyjątek z nazwą wpisu', () => {
    expect(() =>
      czytajTabele({ kolekcje: { 'PORTA VIGO': { style: ['wiejski'] } }, modele: {} }),
    ).toThrow(/PORTA VIGO/)
  })

  it('style nie będące tablicą → wyjątek', () => {
    expect(() =>
      czytajTabele({ kolekcje: {}, modele: { 'PORTA X model 1': { style: 'rustykalny' } } }),
    ).toThrow(/PORTA X model 1/)
  })

  it('has_glass nie będące boolean → wyjątek', () => {
    expect(() =>
      czytajTabele({ kolekcje: {}, modele: { 'PORTA X model 1': { has_glass: 'tak' } } }),
    ).toThrow(/PORTA X model 1/)
  })

  it('pusta tablica stylów jest DOZWOLONA i znaczy "bez stylu"', () => {
    const t = czytajTabele({ kolekcje: {}, modele: { 'PORTA X model 1': { style: [] } } })
    expect(t.modele['PORTA X model 1'].style).toEqual([])
  })

  it('nie-obiekt → wyjątek', () => {
    expect(() => czytajTabele(null)).toThrow()
    expect(() => czytajTabele([])).toThrow()
  })
})

describe('korektaZTabeli — model bije kolekcję, per pole', () => {
  const tabela = czytajTabele({
    kolekcje: { 'PORTA VIGO': { style: ['rustykalny'], has_glass: false } },
    modele: {
      'PORTA VIGO model V.9': { style: ['nowoczesny'] },
      'PORTA VERTE PREMIUM model E.4': { has_glass: true },
    },
  })

  it('brak wpisu → null', () => {
    expect(korektaZTabeli(tabela, 'PORTA NOVA model 1 - Biały')).toBeNull()
  })

  it('wariant koloru dziedziczy korektę swojego modelu', () => {
    expect(korektaZTabeli(tabela, 'PORTA VERTE PREMIUM model E.4 - Biały')).toEqual({
      hasGlass: true,
    })
  })

  it('kolekcja obejmuje wszystkie swoje modele', () => {
    expect(korektaZTabeli(tabela, 'PORTA VIGO model V.1 - Dąb')).toEqual({
      style: ['rustykalny'],
      hasGlass: false,
    })
  })

  it('model przebija kolekcję TYLKO w polu, które sam definiuje', () => {
    // model V.9 nadpisuje styl, ale szkło zostaje z kolekcji
    expect(korektaZTabeli(tabela, 'PORTA VIGO model V.9 - Biały')).toEqual({
      style: ['nowoczesny'],
      hasGlass: false,
    })
  })
})
