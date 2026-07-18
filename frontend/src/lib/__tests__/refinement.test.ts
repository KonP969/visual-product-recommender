import { describe, it, expect } from 'vitest'
import {
  stanPoczątkowy,
  dodajKrok,
  usuńKrok,
  cofnij,
  wyczyść,
  budujZapytanie,
  czyAktywny,
  CHIPY,
} from '../refinement'

const baza = (b: string | null = 'dębowe drzwi') => stanPoczątkowy(b)

describe('CHIPY — definicje', () => {
  it('mają dokładnie dzisiejsze etykiety i poprawne grupy', () => {
    expect(CHIPY.map((c) => c.etykieta)).toEqual([
      'jaśniejsze', 'ciemniejsze', 'ze szkłem', 'bez przeszklenia',
      'drewno naturalne', 'klasyczne',
    ])
    expect(CHIPY.find((c) => c.etykieta === 'jaśniejsze')?.grupa).toBe('jasność')
    expect(CHIPY.find((c) => c.etykieta === 'klasyczne')?.grupa).toBe('styl')
  })
})

describe('dodajKrok — dopinanie i wypieranie', () => {
  it('dopina krok w nowej grupie', () => {
    const s = dodajKrok(baza(), 'klasyczne', 'styl')
    expect(s.kroki).toHaveLength(1)
    expect(s.kroki[0]).toEqual({ etykieta: 'klasyczne', grupa: 'styl', spójnik: ',' })
  })

  it('wypiera poprzedni krok tej samej grupy (szkło ↔ szkło)', () => {
    let s = dodajKrok(baza(), 'ze szkłem', 'szkło')
    s = dodajKrok(s, 'bez przeszklenia', 'szkło')
    expect(s.kroki).toHaveLength(1)
    expect(s.kroki[0].etykieta).toBe('bez przeszklenia')
  })

  it('wypiera w grupie jasność (jaśniejsze ↔ ciemniejsze)', () => {
    let s = dodajKrok(baza(), 'jaśniejsze', 'jasność')
    s = dodajKrok(s, 'ciemniejsze', 'jasność')
    expect(s.kroki).toHaveLength(1)
    expect(s.kroki[0].etykieta).toBe('ciemniejsze')
  })

  it('grupa "własne" kumuluje (dwa wpisane teksty = dwa kroki)', () => {
    let s = dodajKrok(baza(), 'z bulajem', 'własne')
    s = dodajKrok(s, 'do sypialni', 'własne')
    expect(s.kroki).toHaveLength(2)
  })

  it('ponowny klik aktywnego chipa usuwa go (toggle)', () => {
    let s = dodajKrok(baza(), 'klasyczne', 'styl')
    s = dodajKrok(s, 'klasyczne', 'styl')
    expect(s.kroki).toHaveLength(0)
  })

  it('spójnik "ale" tylko dla jasności', () => {
    const s = dodajKrok(baza(), 'jaśniejsze', 'jasność')
    expect(s.kroki[0].spójnik).toBe('ale')
  })
})

describe('dodajKrok — baza null (Gemini padł / low-similarity)', () => {
  it('pierwszy krok staje się bazą, zamiast trafić na listę', () => {
    const s = dodajKrok(baza(null), 'klasyczne', 'styl')
    expect(s.baza).toBe('klasyczne')
    expect(s.kroki).toHaveLength(0)
  })

  it('drugi krok dopina się normalnie', () => {
    let s = dodajKrok(baza(null), 'klasyczne', 'styl')
    s = dodajKrok(s, 'bez przeszklenia', 'szkło')
    expect(s.baza).toBe('klasyczne')
    expect(s.kroki).toHaveLength(1)
    expect(s.kroki[0].etykieta).toBe('bez przeszklenia')
  })

  it('baza=null: ponowny klik chipa-bazy dokłada duplikat (zachowanie zgodne ze spec, bez żetonu)', () => {
    let s = dodajKrok(baza(null), 'klasyczne', 'styl') // pierwszy chip → staje się bazą
    s = dodajKrok(s, 'klasyczne', 'styl')              // kroki puste → toggle nie łapie → dopisany krok
    expect(s.baza).toBe('klasyczne')
    expect(s.kroki).toHaveLength(1)
    expect(budujZapytanie(s)).toBe('klasyczne, klasyczne')
  })
})

describe('usuńKrok / cofnij / wyczyść', () => {
  it('usuńKrok usuwa po indeksie', () => {
    let s = dodajKrok(baza(), 'klasyczne', 'styl')
    s = dodajKrok(s, 'bez przeszklenia', 'szkło')
    s = usuńKrok(s, 0)
    expect(s.kroki).toHaveLength(1)
    expect(s.kroki[0].etykieta).toBe('bez przeszklenia')
  })

  it('cofnij zdejmuje ostatni', () => {
    let s = dodajKrok(baza(), 'klasyczne', 'styl')
    s = dodajKrok(s, 'bez przeszklenia', 'szkło')
    s = cofnij(s)
    expect(s.kroki.map((k) => k.etykieta)).toEqual(['klasyczne'])
  })

  it('cofnij na pustej liście to no-op', () => {
    const s = cofnij(baza())
    expect(s.kroki).toHaveLength(0)
  })

  it('wyczyść zostawia samą bazę', () => {
    let s = dodajKrok(baza(), 'klasyczne', 'styl')
    s = wyczyść(s)
    expect(s.baza).toBe('dębowe drzwi')
    expect(s.kroki).toHaveLength(0)
  })
})

describe('budujZapytanie — zawsze od zera', () => {
  it('składa bazę + kroki z właściwymi spójnikami', () => {
    let s = dodajKrok(baza('dąb'), 'jaśniejsze', 'jasność')
    s = dodajKrok(s, 'bez przeszklenia', 'szkło')
    expect(budujZapytanie(s)).toBe('dąb, ale jaśniejsze, bez przeszklenia')
  })

  it('sama baza bez kroków', () => {
    expect(budujZapytanie(baza('białe drzwi'))).toBe('białe drzwi')
  })
})

describe('baza zamrożona — test na dryf (najważniejszy)', () => {
  it('baza nie zmienia się po kolejnych doprecyzowaniach', () => {
    const start = baza('dębowe drzwi w ciepłym wnętrzu')
    let s = dodajKrok(start, 'klasyczne', 'styl')
    s = dodajKrok(s, 'bez przeszklenia', 'szkło')
    s = dodajKrok(s, 'jaśniejsze', 'jasność')
    expect(s.baza).toBe('dębowe drzwi w ciepłym wnętrzu')
  })
})

describe('czyAktywny', () => {
  it('true dla kroku obecnego w stanie', () => {
    const s = dodajKrok(baza(), 'klasyczne', 'styl')
    expect(czyAktywny(s, 'klasyczne', 'styl')).toBe(true)
    expect(czyAktywny(s, 'ze szkłem', 'szkło')).toBe(false)
  })
})
