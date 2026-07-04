import { describe, it, expect } from 'vitest'
import { applyMMR, categorizeDoor, SearchResultItem } from '../chromaService'

function candidate(
  id: string,
  similarity: number,
  embedding: number[],
): SearchResultItem & { embedding: number[] } {
  return {
    id,
    similarity,
    embedding,
    metadata: { name: id, price: '100', imageUrl: '' },
  }
}

describe('categorizeDoor', () => {
  it.each([
    ['PORTA KONCEPT model A.3 z czarną szybą', 'residential'],
    ['NATURA CLASSIC model 1.3 - Orzech Ciemny', 'residential'],
    ['Drzwi Akustyczne 42 dB', 'specialty'],
    ['PORTA EXTREME RC3 antywłamaniowe', 'specialty'],
    ['Steel SOLID model 1', 'specialty'],
    ['GRANIT C wejściowe', 'specialty'],
    ['Drzwi przeciwpożarowe EI30', 'specialty'],
  ])('categorizes "%s" as %s', (name, expected) => {
    expect(categorizeDoor(name)).toBe(expected)
  })
})

describe('applyMMR', () => {
  it('returns at most k results', () => {
    const candidates = [
      candidate('a', 0.9, [1, 0]),
      candidate('b', 0.8, [0, 1]),
      candidate('c', 0.7, [1, 1]),
    ]
    expect(applyMMR(candidates, 2)).toHaveLength(2)
  })

  it('picks the most relevant candidate first', () => {
    const candidates = [
      candidate('low', 0.5, [1, 0]),
      candidate('high', 0.95, [0, 1]),
    ]
    const results = applyMMR(candidates, 2)
    expect(results[0].id).toBe('high')
  })

  it('prefers diverse results over near-duplicates', () => {
    // "dup" is nearly identical to "top" (same embedding) with slightly lower
    // relevance; "other" is orthogonal. MMR should pick "other" second.
    const candidates = [
      candidate('top', 0.95, [1, 0]),
      candidate('dup', 0.94, [1, 0]),
      candidate('other', 0.85, [0, 1]),
    ]
    const results = applyMMR(candidates, 2)
    expect(results.map((r) => r.id)).toEqual(['top', 'other'])
  })

  it('handles an empty candidate list', () => {
    expect(applyMMR([], 5)).toEqual([])
  })

  it('strips embeddings from returned items', () => {
    const results = applyMMR([candidate('a', 0.9, [1, 0])], 1)
    expect(results[0]).not.toHaveProperty('embedding')
  })
})
