import { describe, it, expect } from 'vitest'
import {
  classifyDoor,
  explicitColorFromQuery,
  explicitWoodFromQuery,
  reasonConflictsWithColor,
  classifyStyles,
  styleFlags,
  explicitStyleFromQuery,
  STYLES,
} from '../attributeService'
import { buildWhere, applySeededJitter } from '../chromaService'
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

describe('explicitColorFromQuery', () => {
  it.each([
    ['drzwi czarne', ['black']],
    ['czarne drzwi', ['black']],
    ['białe drzwi ze szkłem', ['white']],
    ['szare nowoczesne drzwi', ['grey']],
    ['drzwi w kolorze ciemnego orzecha', ['dark_wood']],
  ])('%s → %j', (query, expected) => {
    expect(explicitColorFromQuery(query)).toEqual(expected)
  })

  it.each([
    'czarne, ale jaśniejsze', // korekta względna → LLM decyduje
    'ciemne drzwi', // zakres, nie konkretny kolor
    'jasne drewniane drzwi', // zakres
    'nowoczesne drzwi', // brak koloru
    'czarne albo białe', // dwa kolory → niejednoznaczne
  ])('%s → null (zostawione LLM-owi)', (query) => {
    expect(explicitColorFromQuery(query)).toBeNull()
  })
})

describe('explicitWoodFromQuery', () => {
  const WOOD = ['light_wood', 'medium_wood', 'dark_wood']

  it.each([
    'drzwi dębowe', // gatunek bez odcienia — dziura, przez którą baza narzucała biel
    'drewno naturalne', // etykieta chipa materiału
    'drewniane drzwi',
    'drzwi orzechowe',
    'jesionowe drzwi',
  ])('%s → cała paleta drewna', (query) => {
    expect(explicitWoodFromQuery(query)).toEqual(WOOD)
  })

  it.each([
    'białe drzwi', // brak sygnału drewna
    'nowoczesne drzwi',
    'drewno, ale jaśniejsze', // korekta względna → LLM decyduje
    'dębowe, ale ciemniejsze',
  ])('%s → null (zostawione LLM-owi)', (query) => {
    expect(explicitWoodFromQuery(query)).toBeNull()
  })

  it('nazwany odcień drewna ma pierwszeństwo — kolor, nie cała paleta', () => {
    // "ciemny orzech" to konkretna rodzina; guard koloru łapie to pierwszy
    expect(explicitColorFromQuery('drzwi w kolorze ciemnego orzecha')).toEqual(['dark_wood'])
  })
})

describe('applySeededJitter', () => {
  const candidates = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    similarity: 0.95 - i * 0.001, // niemal-remisy
  }))

  it('is deterministic for the same seed', () => {
    const a = applySeededJitter(candidates, 'seed-1').map((c) => c.id)
    const b = applySeededJitter(candidates, 'seed-1').map((c) => c.id)
    expect(a).toEqual(b)
  })

  it('orders near-ties differently for different seeds', () => {
    const a = applySeededJitter(candidates, 'seed-1').map((c) => c.id)
    const b = applySeededJitter(candidates, 'seed-2').map((c) => c.id)
    expect(a).not.toEqual(b)
  })

  it('does not overturn clear similarity differences', () => {
    const spread = [
      { id: 'best', similarity: 0.95 },
      { id: 'far', similarity: 0.7 },
    ]
    expect(applySeededJitter(spread, 'any-seed')[0].id).toBe('best')
  })
})

describe('parseDoorDescription — filters', () => {
  it('parses valid filters', () => {
    const raw = JSON.stringify({
      clip_query: 'black door',
      display_pl: 'czarne drzwi',
      filters: { colors: ['black'], glass: false },
    })
    expect(parseDoorDescription(raw).filters).toEqual({ colors: ['black'], glass: false, style: null })
  })

  it('drops invalid color values, nulls empty', () => {
    const raw = JSON.stringify({
      clip_query: 'door',
      filters: { colors: ['neon-pink'], glass: 'maybe' },
    })
    expect(parseDoorDescription(raw).filters).toEqual({ colors: null, glass: null, style: null })
  })

  it('missing filters → nulls', () => {
    const raw = JSON.stringify({ clip_query: 'door' })
    expect(parseDoorDescription(raw).filters).toEqual({ colors: null, glass: null, style: null })
  })

  it('parsuje style z listy STYLES, odrzuca spoza', () => {
    const ok = JSON.stringify({ clip_query: 'x', filters: { style: 'loft' } })
    expect(parseDoorDescription(ok).filters.style).toBe('loft')
    const bad = JSON.stringify({ clip_query: 'x', filters: { style: 'brutalist' } })
    expect(parseDoorDescription(bad).filters.style).toBeNull()
    const none = JSON.stringify({ clip_query: 'x', filters: {} })
    expect(parseDoorDescription(none).filters.style).toBeNull()
  })
})

describe('classifyStyles — multi-label z opisu', () => {
  it('modern minimalist → [nowoczesny, minimalistyczny]', () => {
    expect(classifyStyles('white modern minimalist flat panel door')).toEqual(
      ['nowoczesny', 'minimalistyczny'],
    )
  })
  it('classic raised panel → [klasyczny]', () => {
    expect(classifyStyles('warm oak classic raised panel residential door')).toEqual(['klasyczny'])
  })
  it('loft/industrial → [loft]', () => {
    expect(classifyStyles('black industrial loft steel door')).toContain('loft')
  })
  it('brak sygnału → [] (unknown)', () => {
    expect(classifyStyles('a door for a room')).toEqual([])
  })
  it('kolejność wyniku zgodna z STYLES', () => {
    // "scandinavian classic" → klasyczny przed skandynawski (kolejność STYLES)
    const r = classifyStyles('scandinavian classic door')
    expect(r).toEqual(['klasyczny', 'skandynawski'])
  })
})

describe('styleFlags', () => {
  it('ustawia flagi obecnych stylów + style_none=false', () => {
    const f = styleFlags(['klasyczny', 'loft'])
    expect(f.style_klasyczny).toBe(true)
    expect(f.style_loft).toBe(true)
    expect(f.style_nowoczesny).toBe(false)
    expect(f.style_none).toBe(false)
  })
  it('pusty zbiór → style_none=true, reszta false', () => {
    const f = styleFlags([])
    expect(f.style_none).toBe(true)
    expect(STYLES.every((s) => f['style_' + s] === false)).toBe(true)
  })
})

describe('explicitStyleFromQuery', () => {
  it.each([
    ['drzwi klasyczne', 'klasyczny'],
    ['loftowe drzwi', 'loft'],
    ['nowoczesne drzwi', 'nowoczesny'],
    ['drzwi w stylu skandynawskim', 'skandynawski'],
    ['rustykalne drzwi', 'rustykalny'],
  ])('%s → %s', (q, expected) => {
    expect(explicitStyleFromQuery(q)).toBe(expected)
  })
  it.each([
    'nowoczesne albo klasyczne', // dwa style → null
    'jasne drewniane drzwi', // brak stylu
  ])('%s → null', (q) => {
    expect(explicitStyleFromQuery(q)).toBeNull()
  })
})

describe('reasonConflictsWithColor — guard uzasadnień', () => {
  const SZARY = 'PORTA VERRO model V.2 - Szary'
  const DAB = 'PORTA NATURA model B.2 - Dąb Naturalny'

  it('odrzuca odcień spoza nazwy wariantu (zgłoszony bug: grafitowy o Szary)', () => {
    expect(
      reasonConflictsWithColor('płaski panel i grafitowy odcień nadają minimalistyczny wygląd.', SZARY),
    ).toBe(true)
  })

  it('przepuszcza echo prawdziwego koloru', () => {
    expect(
      reasonConflictsWithColor('gładka, szara powierzchnia pasuje do nowoczesnych wnętrz.', SZARY),
    ).toBe(false)
  })

  it('przepuszcza kolor DETALU (czarne szkło na szarych drzwiach)', () => {
    expect(
      reasonConflictsWithColor('czarne szkło i gładki panel pasują do nowoczesnego designu.', SZARY),
    ).toBe(false)
  })

  it('przepuszcza kolor detalu: srebrne intarsje', () => {
    expect(
      reasonConflictsWithColor('szary kolor i srebrne intarsje nadają nowoczesny charakter.', SZARY),
    ).toBe(false)
  })

  it('odrzuca inną rodzinę koloru skrzydła', () => {
    expect(reasonConflictsWithColor('biała powierzchnia rozjaśnia wnętrze.', SZARY)).toBe(true)
  })

  it('odrzuca podmianę gatunku drewna', () => {
    expect(reasonConflictsWithColor('ciepły orzech ociepla salon.', DAB)).toBe(true)
  })

  it('przepuszcza echo gatunku drewna', () => {
    expect(reasonConflictsWithColor('naturalny dąb ociepla wnętrze.', DAB)).toBe(false)
  })

  it('przepuszcza zdanie bez koloru', () => {
    expect(
      reasonConflictsWithColor('prosta forma skrzydła komponuje się z minimalizmem.', SZARY),
    ).toBe(false)
  })

  it('modyfikatory względne (jasny/ciemny) nie są traktowane jak kolor', () => {
    expect(reasonConflictsWithColor('jasna powierzchnia powiększa wnętrze.', SZARY)).toBe(false)
  })

  it('brak wariantu w nazwie → brak porównania', () => {
    expect(reasonConflictsWithColor('grafitowy odcień.', 'PORTA BEZ WARIANTU')).toBe(false)
  })
})
