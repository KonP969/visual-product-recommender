import { describe, it, expect } from 'vitest'
import {
  classifyDoor,
  explicitColorFromQuery,
  explicitWoodFromQuery,
  explicitFinishFromQuery,
  finishMatches,
  reasonConflictsWithColor,
  classifyStyles,
  styleFlags,
  explicitStyleFromQuery,
  STYLES,
  aggregateStyles,
} from '../attributeService'
import type { Style } from '../attributeService'
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
    ['PORTA X - Szałwia', 'grey'],
    ['PORTA X - Farba proszkowana', 'unknown'],
  ])('%s → %s', (name, expected) => {
    expect(classifyDoor(name).colorFamily).toBe(expected)
  })

  // Bug: linia PORTA GLASS nazywa wariant typem szyby ("Szyba matowa", "Szyba
  // grafitowa"), nie kolorem skrzydła — fallback na opis Gemini ("white frosted")
  // dawał 'white', mimo że każde z tych 11 SKU ma w feedzie czarną ramę/okucia.
  it('wariant "Szyba ..." (linia PORTA GLASS, rama zawsze czarna) → black', () => {
    expect(
      classifyDoor(
        'PORTA GLASS szyba matowa - Szyba matowa',
        'frosted glass residential interior glass door white frosted matte modern minimalist',
      ).colorFamily,
    ).toBe('black')
    expect(
      classifyDoor(
        'PORTA GLASS szyba grafitowa matowa - Szyba grafitowa matowa',
        'graphite tinted frosted glass residential interior door',
      ).colorFamily,
    ).toBe('black')
  })

  // Bug: "PORTA GRANDE ... z czarną szybą - Szałwia" i "... Czarne Intarsje - Szałwia"
  // (8 wariantów w katalogu) lądowały jako 'black', bo "Szałwia" nie miała reguły
  // wariantu i klasyfikacja spadała na opis, gdzie wygrywało słowo "black" opisujące
  // AKCENT (szybę/intarsje), nie kolor płyciny. Wariant musi wygrywać z opisem.
  it('kolor wariantu wygrywa, nawet gdy opis wspomina akcent w innym kolorze', () => {
    expect(
      classifyDoor(
        'PORTA GRANDE model G.1 z czarną szybą - Szałwia',
        'Sage green residential interior door with black glass insert, sage lacquered panel, modern minimalist style.',
      ).colorFamily,
    ).toBe('grey')
    expect(
      classifyDoor(
        'PORTA DESIRE model 4 Czarne Intarsje - Szałwia',
        'Sage green residential interior door with black inlays, sage lacquered panel, modern minimalist style.',
      ).colorFamily,
    ).toBe('grey')
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

describe('explicitFinishFromQuery — konkretne wybarwienie', () => {
  it.each([
    ['drzwi w kolorze ciemnego orzecha', 'orzech'],
    ['drzwi dębowe', 'dab'],
    ['jesionowe drzwi', 'jesion'],
    ['drzwi wenge', 'wenge'],
  ])('%s → %s', (query, expected) => {
    expect(explicitFinishFromQuery(query)).toBe(expected)
  })

  it.each(['drewno naturalne', 'białe drzwi', 'ciemne drzwi'])(
    '%s → null (gatunek nienazwany)',
    (query) => {
      expect(explicitFinishFromQuery(query)).toBeNull()
    },
  )
})

describe('finishMatches — nazwa wariantu wobec wybarwienia', () => {
  it('dopasowuje gatunek w nazwie wariantu', () => {
    expect(finishMatches('NATURA CLASSIC model 1.1 - Orzech Ciemny', 'orzech')).toBe(true)
    expect(finishMatches('PORTA LEVEL model B.2 - Dąb Arles Naturalny', 'dab')).toBe(true)
  })

  it('odrzuca inny gatunek z tej samej rodziny koloru', () => {
    // sedno zgłoszenia A2: dąb ciemny to nie orzech, choć oba to dark_wood
    expect(finishMatches('PORTA CLASSIC HOME model C.1 - Dąb Ciemny', 'orzech')).toBe(false)
    expect(finishMatches('PORTA VERTE HOME model H.1 - Wenge White', 'dab')).toBe(false)
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

// docs/otwarte-zadania.md §2: opisy Gemini prawie nigdy nie mówią wprost
// "scandinavian"/"nordic", więc /scandinav|nordic/i w STYLE_SIGNALS prawie nigdy
// nie trafia (2 warianty w całym katalogu). Sygnał z prompta wizji
// (visionStylePass.ts): "pale wood AND deliberately light, airy, simple — not
// merely light coloured" → jasne drewno (color_family light_wood) PLUS świadoma
// prostota (to samo słowo co minimalistyczny). Wymagamy obu, żeby NIE łapać
// każdych jasnych drzwi (np. "warm elegant" bez "minimalist" nie kwalifikuje).
describe('classifyStyles — skandynawski z koloru (light_wood + minimalistyczny)', () => {
  it('jasne drewno + minimalistyczny → dokłada skandynawski', () => {
    expect(classifyStyles('light oak wood grain modern flat panel minimalist door', 'light_wood')).toEqual([
      'nowoczesny',
      'minimalistyczny',
      'skandynawski',
    ])
  })
  it('jasne drewno BEZ minimalistyczny → sam kolor nie wystarcza', () => {
    expect(classifyStyles('light oak wood grain modern flat panel warm elegant door', 'light_wood')).toEqual([
      'nowoczesny',
    ])
  })
  it('minimalistyczny BEZ jasnego drewna → nie dokłada skandynawski', () => {
    expect(classifyStyles('black modern minimalist flat panel door', 'black')).toEqual([
      'nowoczesny',
      'minimalistyczny',
    ])
  })
  it('brak informacji o kolorze (wywołanie bez drugiego argumentu) → zachowanie bez zmian', () => {
    expect(classifyStyles('light oak wood grain modern flat panel minimalist door')).toEqual([
      'nowoczesny',
      'minimalistyczny',
    ])
  })
  it('kolejność wyniku zostaje zgodna z STYLES, nawet gdy skandynawski dochodzi z koloru', () => {
    expect(
      classifyStyles('light oak classic raised panel minimalist ornate glamour door', 'light_wood'),
    ).toEqual(['klasyczny', 'minimalistyczny', 'skandynawski', 'glamour'])
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

describe('aggregateStyles — głosy wariantów → style modelu', () => {
  it('większość głosów wygrywa', () => {
    expect(aggregateStyles([['nowoczesny'], ['nowoczesny'], ['klasyczny']])).toEqual(['nowoczesny'])
  })

  it('multi-label: każdy styl z większością przechodzi', () => {
    expect(
      aggregateStyles([
        ['nowoczesny', 'minimalistyczny'],
        ['nowoczesny', 'minimalistyczny'],
        ['nowoczesny'],
      ]),
    ).toEqual(['nowoczesny', 'minimalistyczny'])
  })

  it('brak większości → styl z największą liczbą głosów', () => {
    // klasyczny 2/4 to NIE większość (>50%), ale jest liderem
    expect(
      aggregateStyles([['klasyczny'], ['nowoczesny'], ['glamour'], ['klasyczny']]),
    ).toEqual(['klasyczny'])
  })

  it('remis liderów → wszyscy liderzy', () => {
    expect(aggregateStyles([['klasyczny'], ['nowoczesny']])).toEqual(['klasyczny', 'nowoczesny'])
  })

  it('pojedynczy wariant dyktuje styl modelu', () => {
    expect(aggregateStyles([['rustykalny']])).toEqual(['rustykalny'])
  })

  it('żaden wariant nie ma stylu → pusto (style_none)', () => {
    expect(aggregateStyles([[], [], []])).toEqual([])
  })

  it('brak wariantów → pusto', () => {
    expect(aggregateStyles([])).toEqual([])
  })

  it('szum jednego wariantu nie robi modelu rustykalnym', () => {
    // PORTA FIT model H.2: 19 wariantów, jeden opis ma "rustic touch"
    const głosy: Style[][] = Array.from({ length: 19 }, (_, i) =>
      i === 5 ? ['nowoczesny' as Style, 'rustykalny' as Style] : ['nowoczesny' as Style],
    )
    expect(aggregateStyles(głosy)).toEqual(['nowoczesny'])
  })
})
