// Stan zapytania jako czysta struktura — bez Reacta, bez sieci. Sedno poprawki:
// `baza` (opis wnętrza z pierwszego wyszukiwania) jest zamrożona, a kroki są
// jawną, odwracalną listą. Dzięki temu zapytanie budujemy zawsze od zera i LLM
// nigdy nie karmi sam siebie własną parafrazą (koniec dryfu).

export type Grupa = 'szkło' | 'jasność' | 'styl' | 'materiał' | 'własne'

export interface Krok {
  etykieta: string          // słowa użytkownika, np. "bez przeszklenia"
  grupa: Grupa
  spójnik: 'ale' | ','      // wynika z grupy, nie z widzimisię
}

export interface StanZapytania {
  baza: string | null       // opis z displayPl pierwszego wyszukiwania; zamrożony
  kroki: Krok[]
}

export interface DefChipa {
  etykieta: string
  grupa: Grupa
}

// Kolejność = kolejność renderu palety. Etykiety jak dziś w Rail.tsx.
export const CHIPY: DefChipa[] = [
  { etykieta: 'jaśniejsze', grupa: 'jasność' },
  { etykieta: 'ciemniejsze', grupa: 'jasność' },
  { etykieta: 'ze szkłem', grupa: 'szkło' },
  { etykieta: 'bez przeszklenia', grupa: 'szkło' },
  { etykieta: 'drewno naturalne', grupa: 'materiał' },
  { etykieta: 'klasyczne', grupa: 'styl' },
]

// "ale" tylko dla korekt względnych (jasność) — "dąb, ale jaśniejsze".
// Reszta to dopowiedzenia: przecinek. "dąb, ale klasyczne" fałszywie sugerowało
// LLM-owi sprzeczność, stąd rozróżnienie.
const spójnikDla = (grupa: Grupa): 'ale' | ',' => (grupa === 'jasność' ? 'ale' : ',')

export function stanPoczątkowy(baza: string | null): StanZapytania {
  return { baza, kroki: [] }
}

export function czyAktywny(stan: StanZapytania, etykieta: string, grupa: Grupa): boolean {
  return stan.kroki.some((k) => k.grupa === grupa && k.etykieta === etykieta)
}

export function dodajKrok(stan: StanZapytania, etykieta: string, grupa: Grupa): StanZapytania {
  // Toggle: ponowny klik identycznego chipa (poza "własne") zdejmuje go.
  const idx = stan.kroki.findIndex((k) => k.grupa === grupa && k.etykieta === etykieta)
  if (idx >= 0 && grupa !== 'własne') {
    return { ...stan, kroki: stan.kroki.filter((_, i) => i !== idx) }
  }

  // Baza null (Gemini padł / low-similarity): pierwszy krok STAJE SIĘ bazą,
  // zamiast trafić na listę — bez duplikacji.
  if (stan.baza === null && stan.kroki.length === 0) {
    return { baza: etykieta, kroki: [] }
  }

  const krok: Krok = { etykieta, grupa, spójnik: spójnikDla(grupa) }
  // Wypieranie w grupie (poza "własne", która się kumuluje).
  const bez = grupa === 'własne' ? stan.kroki : stan.kroki.filter((k) => k.grupa !== grupa)
  return { ...stan, kroki: [...bez, krok] }
}

export function usuńKrok(stan: StanZapytania, index: number): StanZapytania {
  return { ...stan, kroki: stan.kroki.filter((_, i) => i !== index) }
}

export function cofnij(stan: StanZapytania): StanZapytania {
  return { ...stan, kroki: stan.kroki.slice(0, -1) }
}

export function wyczyść(stan: StanZapytania): StanZapytania {
  return { ...stan, kroki: [] }
}

export function budujZapytanie(stan: StanZapytania): string {
  const baza = stan.baza ?? ''
  const złożone = stan.kroki.reduce(
    (q, k) => (k.spójnik === 'ale' ? `${q}, ale ${k.etykieta}` : `${q}, ${k.etykieta}`),
    baza,
  )
  // Guard na wypadek pustej bazy (nie powinno wystąpić — baza-null przejmuje
  // pierwszy krok — ale nie chcemy zapytania zaczynającego się od ", ").
  return złożone.replace(/^,\s*/, '')
}
