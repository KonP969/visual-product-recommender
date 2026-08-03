// Komunikaty o POMINIĘTYCH filtrach. Cicha podmiana kryteriów wygląda jak awaria
// wyszukiwarki i kosztuje zaufanie, więc każdy odrzucony filtr ma własne zdanie.
//
// Ten moduł trzyma też decyzję "czy pominąć filtr stylu" (resolveStyleFilter /
// decydujOStylu) — wyciągniętą tu z obu tras /search i /search-text (były
// zduplikowane słowo w słowo), żeby reguła miała jedno miejsce i własne testy.
import { countStyles } from '../services/styleIndex'
import type { HardFilters } from '../services/chromaService'
import type { Style } from '../services/attributeService'

// Klucz techniczny wybarwienia → nazwa, którą klient sam by wypowiedział.
const FINISH_PL: Record<string, string> = {
  orzech: 'orzech',
  dab: 'dąb',
  jesion: 'jesion',
  akacja: 'akacja',
  sosna: 'sosna',
  buk: 'buk',
  wenge: 'wenge',
  hikora: 'hikora',
}

// Enum stylu → przymiotnik w miejscowniku ("w stylu rustykalnym").
const STYLE_PL: Record<string, string> = {
  klasyczny: 'klasycznym',
  nowoczesny: 'nowoczesnym',
  minimalistyczny: 'minimalistycznym',
  rustykalny: 'rustykalnym',
  loft: 'loftowym',
  skandynawski: 'skandynawskim',
  glamour: 'glamour',
}

export function buildNotice(droppedFinish?: string, droppedStyle?: string): string | undefined {
  const zdania: string[] = []
  if (droppedFinish) {
    zdania.push(
      `Nie mamy drzwi w wybarwieniu „${FINISH_PL[droppedFinish] ?? droppedFinish}” przy pozostałych kryteriach — pokazujemy zbliżone kolorystycznie.`,
    )
  }
  if (droppedStyle) {
    zdania.push(
      `Nie mamy drzwi w stylu ${STYLE_PL[droppedStyle] ?? droppedStyle} przy pozostałych kryteriach — pokazujemy wyniki bez filtra stylu.`,
    )
  }
  return zdania.length > 0 ? zdania.join(' ') : undefined
}

export interface RezultatStylu {
  styleCounts: Record<Style, number>
  filters: HardFilters | undefined
  droppedStyle?: Style
}

/**
 * Czysta reguła decyzyjna (F1+F5), bez sieci: dostaje GOTOWE liczniki (policzone
 * z aktywnym `finish`) i — gdy są pod ręką — liczniki policzone BEZ `finish`.
 *
 * `finish` jest filtrem MIĘKKIM w chromaService.searchSimilar: gdy pula
 * kandydatów nie ma trafień o tym wybarwieniu, filtr jest po cichu odrzucany
 * (droppedFinish). countStylesIn nie wie o tym i liczy tak, jakby finish był
 * twardy — więc gatunek drewna, którego katalog w ogóle nie ma (np. "buk"),
 * zeruje WSZYSTKIE liczniki stylu naraz, nie tylko żądanego. Decyzja o
 * pominięciu stylu na podstawie takich liczników byłaby fałszywa (F1).
 */
export function decydujOStylu(
  filters: HardFilters | undefined,
  counts: Record<Style, number>,
  countsBezFinish: Record<Style, number> | null,
): RezultatStylu {
  if (!filters?.style) {
    return { styleCounts: counts, filters }
  }
  if (counts[filters.style] > 0) {
    return { styleCounts: counts, filters }
  }

  // Zero dla żądanego stylu. Jeśli WSZYSTKIE liczniki wyszły zerowe i mamy
  // przeliczenie bez finish — to finish wyzerował całą pulę, nie brak stylu
  // w katalogu. Wtedy liczy się przeliczenie bez finish — i ono trafia też
  // do usera jako styleCounts (pokazujemy przekrój, który faktycznie ma sens).
  const finishWyzerowałWszystko =
    !!filters.finish && !!countsBezFinish && Object.values(counts).every((n) => n === 0)
  const efektywne = finishWyzerowałWszystko ? countsBezFinish! : counts

  if (efektywne[filters.style] > 0) {
    return { styleCounts: efektywne, filters }
  }
  return {
    styleCounts: efektywne,
    filters: { ...filters, style: null },
    droppedStyle: filters.style,
  }
}

/**
 * Orkiestracja: liczy przekrój stylów (filtr stylu sam wykluczony — liczymy
 * przekrój, w którym chip dopiero ma być kliknięty), a gdy trzeba, dolicza
 * drugie, tanie przeliczenie bez finish (indeks trzyma nazwy wariantów w
 * pamięci, ~4 ms na ciepłym indeksie — patrz styleIndex.ts).
 */
export async function resolveStyleFilter(filters: HardFilters | undefined): Promise<RezultatStylu> {
  const counts = await countStyles({ ...filters, style: null })
  const trzebaPrzeliczyćBezFinish =
    !!filters?.style &&
    counts[filters.style] === 0 &&
    !!filters?.finish &&
    Object.values(counts).every((n) => n === 0)
  const countsBezFinish = trzebaPrzeliczyćBezFinish
    ? await countStyles({ ...filters, style: null, finish: null })
    : null
  return decydujOStylu(filters, counts, countsBezFinish)
}
