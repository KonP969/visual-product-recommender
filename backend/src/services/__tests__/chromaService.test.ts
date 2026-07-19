import { describe, it, expect } from 'vitest'
import { applyMMR, buildWhere, categorizeDoor, isDoorProduct, SearchResultItem } from '../chromaService'

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

describe('isDoorProduct — odsiew nie-drzwi z feedu', () => {
  it.each([
    ['Klamki', false],
    ['Akcesoria', false],
    ['Ościeżnice', false],
  ])('kategoria "%s" → nie jest drzwiami', (cat, expected) => {
    expect(isDoorProduct(cat)).toBe(expected)
  })

  it.each([
    ['Drzwi wewnętrzne'],
    ['Drzwi wejściowe do mieszkania'],
    ['Drzwi techniczne'],
    ['Drzwi szklane'],
    ['Drzwi przesuwne'],
    ['Drzwi składane'],
    ['Porta Loft Steel'],
  ])('kategoria "%s" → drzwi', (cat) => {
    expect(isDoorProduct(cat)).toBe(true)
  })

  // 379 realnych drzwi w feedzie nie ma category_main (PORTA UNI KOLOR MODERN,
  // CLASSIC C.2, KWARC …) — brak kategorii NIE MOŻE ich odsiewać.
  it.each([undefined, null, ''])('brak kategorii (%s) → drzwi (nie odsiewamy)', (cat) => {
    expect(isDoorProduct(cat)).toBe(true)
  })

  it('nie jest wrażliwa na wielkość liter i białe znaki', () => {
    expect(isDoorProduct('  klamki  ')).toBe(false)
    expect(isDoorProduct('AKCESORIA')).toBe(false)
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

describe('buildWhere — filtr stylu z zabezpieczeniem', () => {
  it('styl → $or (styl LUB bezstylowe)', () => {
    const where = buildWhere({ style: 'klasyczny' }) as { $and?: unknown[] }
    // przy samym stylu: pojedynczy warunek NIE jest owijany w $and, chyba że jest też category
    const cond = JSON.stringify(where)
    expect(cond).toContain('style_klasyczny')
    expect(cond).toContain('style_none')
  })

  it('styl łączy się z kolorem przez $and', () => {
    const where = buildWhere({ colors: ['black'], style: 'loft' }) as { $and: unknown[] }
    expect(where.$and).toContainEqual({ color_family: { $in: ['black'] } })
    expect(where.$and).toContainEqual({
      $or: [{ style_loft: true }, { style_none: true }],
    })
  })

  it('brak stylu → brak warunku stylu', () => {
    expect(JSON.stringify(buildWhere({ colors: ['white'] }))).not.toContain('style_')
  })
})
