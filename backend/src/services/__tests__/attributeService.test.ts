import { describe, it, expect } from 'vitest'
import { classifyDoor } from '../attributeService'
import { buildWhere } from '../chromaService'
import { parseDoorDescription } from '../geminiService'

describe('classifyDoor — color from variant', () => {
  it.each([
    ['PORTA X - Biały', 'white'],
    ['PORTA X - Czarny Struktura', 'black'],
    ['PORTA X - Antracyt HPL/CPL Struktura', 'grey'],
    ['PORTA X - Kaszmir', 'beige'],
    ['PORTA X - Dąb Craft Złoty', 'light_wood'],
    ['PORTA X - Dąb Naturalny', 'light_wood'],
    ['PORTA X - Dąb Matowy Ciemny', 'dark_wood'],
    ['PORTA X - Orzech Naturalny', 'medium_wood'],
    ['PORTA X - Orzech Ciemny', 'dark_wood'],
    ['PORTA X - Wenge White', 'light_wood'],
    ['PORTA X - Mocca', 'dark_wood'],
    ['PORTA X - Dąb Winchester', 'medium_wood'],
    ['PORTA X - Farba proszkowana', 'unknown'],
  ])('%s → %s', (name, expected) => {
    expect(classifyDoor(name).colorFamily).toBe(expected)
  })
})

describe('classifyDoor — color from description fallback', () => {
  it('uses the English description head when no variant', () => {
    expect(classifyDoor('PORTA GLASS szyba grafitowa', 'graphite tinted frosted glass door').colorFamily).toBe('grey')
    expect(classifyDoor('PORTA X model A.1', 'black lacquered flat panel residential door').colorFamily).toBe('black')
    expect(classifyDoor('PORTA X model B.2', 'light oak wood grain modern door').colorFamily).toBe('light_wood')
  })

  it('ignores colours mentioned deep in the description (past the head)', () => {
    const desc =
      'residential interior door for a hallway or living room, modern and minimalist with black handle accents'
    expect(classifyDoor('PORTA X model C.3', desc).colorFamily).toBe('unknown')
  })
})

describe('classifyDoor — glass detection', () => {
  it.each([
    ['PORTA KONCEPT model A.3 z czarną szybą - Biały', true],
    ['NATURA CLASSIC model 1.1 z bulajem - Orzech', true],
    ['PORTA GLASS szyba grafitowa', true],
    ['PORTA VERTE model B.5 Szprosy', true],
    ['PORTA LINE model H.1 czarne intarsje - Czarny', false],
    ['PORTA ORNATO model O.1 - Czarny', false],
  ])('%s → hasGlass=%s', (name, expected) => {
    expect(classifyDoor(name).hasGlass).toBe(expected)
  })
})

describe('buildWhere', () => {
  it('category only when no filters', () => {
    expect(buildWhere()).toEqual({ category: 'residential' })
    expect(buildWhere({ colors: null, glass: null })).toEqual({ category: 'residential' })
  })

  it('adds color $in and has_glass', () => {
    expect(buildWhere({ colors: ['black'], glass: false })).toEqual({
      $and: [
        { category: 'residential' },
        { color_family: { $in: ['black'] } },
        { has_glass: false },
      ],
    })
  })

  it('glass=false is a real condition (not dropped as falsy)', () => {
    const where = buildWhere({ glass: false }) as { $and: unknown[] }
    expect(where.$and).toContainEqual({ has_glass: false })
  })
})

describe('parseDoorDescription — filters', () => {
  it('parses valid filters', () => {
    const raw = JSON.stringify({
      clip_query: 'black door',
      display_pl: 'czarne drzwi',
      filters: { colors: ['black'], glass: false },
    })
    expect(parseDoorDescription(raw).filters).toEqual({ colors: ['black'], glass: false })
  })

  it('drops invalid color values, nulls empty', () => {
    const raw = JSON.stringify({
      clip_query: 'door',
      filters: { colors: ['neon-pink'], glass: 'maybe' },
    })
    expect(parseDoorDescription(raw).filters).toEqual({ colors: null, glass: null })
  })

  it('missing filters → nulls', () => {
    const raw = JSON.stringify({ clip_query: 'door' })
    expect(parseDoorDescription(raw).filters).toEqual({ colors: null, glass: null })
  })
})
