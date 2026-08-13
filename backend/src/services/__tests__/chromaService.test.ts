import { describe, it, expect } from 'vitest'
import {
  applyMMR,
  applyTrueVariantCounts,
  buildWhere,
  categorizeDoor,
  dedupeByName,
  isDoorProduct,
  SearchResultItem,
} from '../chromaService'

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
    ['PORTA STEEL SAFE model D.1 - Biały Matt', 'specialty'],
    ['PORTA, STEEL SAFE, Energy Protect D.1 - Antracyt', 'specialty'],
    ['System przesuwny bezościeżnicowy - Skrzydło - Biały', 'specialty'],
  ])('categorizes "%s" as %s', (name, expected) => {
    expect(categorizeDoor(name)).toBe(expected)
  })
})

describe('isDoorProduct — odsiew nie-drzwi z feedu', () => {
  it.each([
    ['Klamki', false],
    ['Akcesoria', false],
    ['Ościeżnice', false],
    ['Drzwi wejściowe do mieszkania', false],
    ['Drzwi techniczne', false],
    ['Drzwi przesuwne', false],
    ['Drzwi składane', false],
  ])('kategoria "%s" → nie jest drzwiami', (cat, expected) => {
    expect(isDoorProduct(cat)).toBe(expected)
  })

  it.each([
    ['Drzwi wewnętrzne'],
    ['Drzwi szklane'],
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
    expect(isDoorProduct('  Drzwi Techniczne  ')).toBe(false)
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

describe('dedupeByName — zwijanie po nazwie', () => {
  const item = (id: string, name: string, price: string, similarity: number) => ({
    id,
    similarity,
    embedding: [1, 0],
    metadata: { name, price, imageUrl: '' },
  })

  it('zwija identyczne nazwy do jednego (reprezentant = pierwszy)', () => {
    const out = dedupeByName([
      item('a', 'HIDE 1.1 - Biały', '798', 0.95),
      item('b', 'HIDE 1.1 - Biały', '540', 0.94),
      item('c', 'HIDE 1.1 - Biały', '1266', 0.93),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a') // najlepiej dopasowany
    expect(out[0].variantCount).toBe(3)
    expect(out[0].priceFrom).toBe('540') // najtańszy w grupie
  })

  it('różne nazwy zostają wszystkie', () => {
    const out = dedupeByName([
      item('a', 'HIDE 1.1 - Biały', '798', 0.95),
      item('b', 'AGAT R.2 - Dąb', '2220', 0.94),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((o) => o.variantCount)).toEqual([1, 1])
  })

  it('"bezprzylgowe" (inna nazwa) NIE zwija się z bazowym', () => {
    const out = dedupeByName([
      item('a', 'HIDE 1.1 - Biały', '798', 0.95),
      item('b', 'HIDE 1.1 bezprzylgowe - Biały', '820', 0.94),
    ])
    expect(out).toHaveLength(2)
  })

  it('singleton: variantCount=1, priceFrom = własna cena', () => {
    const out = dedupeByName([item('a', 'X - Y', '333', 0.9)])
    expect(out[0].variantCount).toBe(1)
    expect(out[0].priceFrom).toBe('333')
  })

  it('zachowuje kolejność rankingu (pierwsze wystąpienie nazwy)', () => {
    const out = dedupeByName([
      item('a', 'A - x', '10', 0.99),
      item('b', 'B - y', '20', 0.98),
      item('c', 'A - x', '5', 0.97),
    ])
    expect(out.map((o) => o.id)).toEqual(['a', 'b'])
    expect(out[0].priceFrom).toBe('5') // min z grupy A mimo że rep to 'a'
  })

  it('cena niebędąca liczbą nie psuje min', () => {
    const out = dedupeByName([
      item('a', 'A - x', '—', 0.9),
      item('b', 'A - x', '100', 0.89),
    ])
    expect(out[0].priceFrom).toBe('100')
  })
})

// docs/manual-review-checklist.md §F: "N wariantów do wyboru" na karcie nie zgadzało
// się z konfiguratorem — bo dedupeByName liczy tylko duplikaty W PULI TEGO
// wyszukiwania, nie prawdziwą liczbę wariantów w całym katalogu. applyTrueVariantCounts
// nadpisuje variantCount PO rankingu, prawdziwą liczbą z indeksu nazw.
describe('applyTrueVariantCounts — prawdziwa liczba z całego katalogu, nie z puli', () => {
  const wynik = (id: string, name: string, variantCount: number) => ({
    id,
    similarity: 0.9,
    metadata: { name, price: '100', imageUrl: '' },
    variantCount,
    priceFrom: '100',
  })

  it('nadpisuje variantCount z puli (2) prawdziwą liczbą z katalogu (8)', () => {
    const counts = new Map([['PORTA X model A.0 - Biały', 8]])
    const [out] = applyTrueVariantCounts([wynik('a', 'PORTA X model A.0 - Biały', 2)], counts)
    expect(out.variantCount).toBe(8)
  })

  it('nazwa nieobecna w indeksie (np. race z invalidacją) zostawia liczbę z puli', () => {
    const counts = new Map([['INNA NAZWA', 5]])
    const [out] = applyTrueVariantCounts([wynik('a', 'PORTA X model A.0 - Biały', 2)], counts)
    expect(out.variantCount).toBe(2)
  })

  it('nie rusza innych pól wyniku', () => {
    const counts = new Map([['PORTA X model A.0 - Biały', 8]])
    const [out] = applyTrueVariantCounts([wynik('a', 'PORTA X model A.0 - Biały', 2)], counts)
    expect(out.id).toBe('a')
    expect(out.priceFrom).toBe('100')
  })
})

describe('applyMMR — zachowuje variantCount/priceFrom', () => {
  it('nowe pola przechodzą przez MMR', () => {
    const c = {
      id: 'a',
      similarity: 0.9,
      embedding: [1, 0],
      metadata: { name: 'A', price: '10', imageUrl: '' },
      variantCount: 3,
      priceFrom: '5',
    }
    const [out] = applyMMR([c], 1)
    expect(out.variantCount).toBe(3)
    expect(out.priceFrom).toBe('5')
    expect(out).not.toHaveProperty('embedding')
  })
})

describe('buildWhere — filtr stylu', () => {
  // Zabezpieczenie "$or [styl, style_none]" ZDJĘTE świadomie (decyzja 2026-08-03).
  // Chroniło 425 wariantów z ubogim opisem, ale po przejściu na styl per model
  // zostało ich 26 (0,3%) — a psuły dwie rzeczy naraz: liczba na chipie przestawała
  // odpowiadać długości listy, a bezstylowe potrafiły wygrać pierwsze miejsce
  // z prawdziwymi trafieniami (PORTA VERTE HOME B.5 przy filtrze rustykalnym).
  // Pusty przekrój ma teraz jawny komunikat (resolveStyleFilter) — czyli uczciwą
  // wersję tego samego podstawienia.
  it('styl → twardy warunek na fladze stylu, bez bezstylowych', () => {
    const cond = JSON.stringify(buildWhere({ style: 'klasyczny' }))
    expect(cond).toContain('style_klasyczny')
    expect(cond).not.toContain('style_none')
  })

  it('styl łączy się z kolorem przez $and', () => {
    const where = buildWhere({ colors: ['black'], style: 'loft' }) as { $and: unknown[] }
    expect(where.$and).toContainEqual({ color_family: { $in: ['black'] } })
    expect(where.$and).toContainEqual({ style_loft: true })
  })

  it('brak stylu → brak warunku stylu', () => {
    expect(JSON.stringify(buildWhere({ colors: ['white'] }))).not.toContain('style_')
  })
})
