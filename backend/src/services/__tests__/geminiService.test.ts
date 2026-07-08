import { describe, it, expect } from 'vitest'
import { parseDoorDescription } from '../geminiService'

const NO_FILTERS = { colors: null, glass: null }

describe('parseDoorDescription', () => {
  it('parses a plain JSON response', () => {
    const raw = '{"clip_query": "white matte residential door", "display_pl": "białe, matowe drzwi"}'
    expect(parseDoorDescription(raw)).toEqual({
      clipQuery: 'white matte residential door',
      displayPl: 'białe, matowe drzwi',
      filters: NO_FILTERS,
    })
  })

  it('strips markdown code fences', () => {
    const raw = '```json\n{"clip_query": "black door", "display_pl": "czarne drzwi"}\n```'
    expect(parseDoorDescription(raw)).toEqual({
      clipQuery: 'black door',
      displayPl: 'czarne drzwi',
      filters: NO_FILTERS,
    })
  })

  it('falls back to clip_query when display_pl is missing', () => {
    const raw = '{"clip_query": "oak residential door"}'
    expect(parseDoorDescription(raw)).toEqual({
      clipQuery: 'oak residential door',
      displayPl: 'oak residential door',
      filters: NO_FILTERS,
    })
  })

  it('throws when clip_query is missing', () => {
    expect(() => parseDoorDescription('{"display_pl": "drzwi"}')).toThrow('no clip_query')
  })

  it('throws on invalid JSON', () => {
    expect(() => parseDoorDescription('not json at all')).toThrow()
  })

  it('trims whitespace in values', () => {
    const raw = '{"clip_query": "  grey door  ", "display_pl": " szare drzwi "}'
    expect(parseDoorDescription(raw)).toEqual({
      clipQuery: 'grey door',
      displayPl: 'szare drzwi',
      filters: NO_FILTERS,
    })
  })
})
