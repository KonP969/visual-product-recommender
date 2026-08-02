import { describe, it, expect } from 'vitest'
import { buildNotice } from '../searchNotices'

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
