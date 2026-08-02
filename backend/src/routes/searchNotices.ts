// Komunikaty o POMINIĘTYCH filtrach. Cicha podmiana kryteriów wygląda jak awaria
// wyszukiwarki i kosztuje zaufanie, więc każdy odrzucony filtr ma własne zdanie.

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
