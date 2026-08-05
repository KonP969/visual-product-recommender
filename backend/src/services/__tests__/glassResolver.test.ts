import { describe, it, expect } from 'vitest'
import { modelOf, decideGlassFromName, glassForModelName } from '../glassResolver'

describe('modelOf', () => {
  it.each([
    ['PORTA CLASSIC HOME model C.2 - Szary', 'PORTA CLASSIC HOME model C.2'],
    ['PORTA VERTE HOME model H.1 z czarną szybą - Dąb Klasyczny', 'PORTA VERTE HOME model H.1 z czarną szybą'],
    ['PORTA UNI KOLOR MODERN model 1.1', 'PORTA UNI KOLOR MODERN model 1.1'], // brak wariantu
  ])('%s → %s', (name, expected) => {
    expect(modelOf(name)).toBe(expected)
  })
})

describe('decideGlassFromName — precedencja z nazw', () => {
  it('dowolny wariant z GLASS_RE → true', () => {
    expect(decideGlassFromName([
      'PORTA KONCEPT model A.3 z czarną szybą - Biały',
      'PORTA KONCEPT model A.3 z czarną szybą - Dąb',
    ])).toBe(true)
  })

  it('dowolny wariant z SOLID_NAME_RE (pełne) → false', () => {
    expect(decideGlassFromName(['PORTA VECTOR model pełne - Biały'])).toBe(false)
  })

  it('cichy model (brak słów o szkle w nazwie) → null', () => {
    expect(decideGlassFromName([
      'PORTA CLASSIC HOME model C.2 - Szary',
      'PORTA CLASSIC HOME model C.2 - Biały',
    ])).toBeNull()
  })

  it('glass wygrywa gdy jeden wariant ma szybę, inny nie', () => {
    expect(decideGlassFromName([
      'PORTA X model 1 - Biały',
      'PORTA X model 1 z szybą - Dąb',
    ])).toBe(true)
  })

  it('pusta lista → null', () => {
    expect(decideGlassFromName([])).toBeNull()
  })
})

describe('glassForModelName — korekta przebija decyzję automatu', () => {
  it('bez wpisu w tabeli zwraca decyzję automatu', () => {
    expect(glassForModelName('PORTA NOVA model 1', true)).toBe(true)
    expect(glassForModelName('PORTA NOVA model 1', false)).toBe(false)
  })

  it('bez wpisu i bez decyzji zwraca null (model cichy)', () => {
    expect(glassForModelName('PORTA NOVA model 1', null)).toBeNull()
  })
})
