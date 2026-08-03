// Liczniki trafień per styl dla chipów: „ile jest białych klasycznych" liczymy
// z lekkiego indeksu metadanych w pamięci (wzorzec nameIndex z chromaService).
// Zmierzone na katalogu 10 873 rekordów: 7 zapytań do Chromy z `where` kosztuje
// 330–375 ms na KAŻDE wyszukiwanie, budowa indeksu ~3,3 s jednorazowo, a liczenie
// na ciepłym indeksie ~4 ms. Dlatego serwer rozgrzewa indeks przy starcie (index.ts).
//
// Unieważnianie działa TYLKO w procesie, który je wywołał: import z UI biegnie
// w procesie Expressa, więc tam jest natychmiastowe. Ale `syncCatalog` i
// `backfillStyle` to osobne procesy ts-node — po nich działający backend trzyma
// stare liczniki, dopóki go nie zrestartujesz. Oba skrypty o tym przypominają
// na końcu swojego wyjścia.
import { ChromaClient } from 'chromadb'
import { STYLES, finishMatches } from './attributeService'
import type { Style } from './attributeService'
import type { HardFilters, ProductMetadata } from './chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const BATCH = 500

export interface WierszIndeksu {
  name: string
  colorFamily?: string
  hasGlass?: boolean
  styles: Style[]
}

function pusteLiczniki(): Record<Style, number> {
  return Object.fromEntries(STYLES.map((s) => [s, 0])) as Record<Style, number>
}

/**
 * Trafienia ŚCISŁE per styl przy pozostałych twardych filtrach. Filtr stylu jest
 * świadomie ignorowany — liczymy przekrój, w którym chip dopiero ma być kliknięty.
 * Drzwi bezstylowe dają 0 wszędzie: chip ma mówić „ile jest takich drzwi",
 * a nie „ile zobaczę po doliczeniu bezstylowych".
 */
export function countStylesIn(rows: WierszIndeksu[], filters?: HardFilters): Record<Style, number> {
  const liczniki = pusteLiczniki()
  for (const r of rows) {
    if (filters?.colors && filters.colors.length > 0 && !filters.colors.includes(r.colorFamily ?? '')) {
      continue
    }
    if ((filters?.glass === true || filters?.glass === false) && r.hasGlass !== filters.glass) {
      continue
    }
    if (filters?.finish && !finishMatches(r.name, filters.finish)) continue
    for (const s of r.styles) liczniki[s]++
  }
  return liczniki
}

let indeks: WierszIndeksu[] | null = null
// Budowa trwa ~3,3 s. Bez zapamiętania OBIETNICY dwa wyszukiwania, które trafią
// w okno zimnego startu, wykonałyby pełny skan każde — dlatego drugie czeka na
// pierwsze. Generacja odcina wyścig: gdy indeks unieważniono w trakcie budowy,
// jej wynik jest już nieaktualny i nie wolno go zapisać.
let budowa: Promise<WierszIndeksu[]> | null = null
let generacja = 0

export function invalidateStyleIndex(): void {
  indeks = null
  budowa = null
  generacja++
}

async function getIndeks(): Promise<WierszIndeksu[]> {
  if (indeks) return indeks
  if (budowa) return budowa

  const mojaGeneracja = generacja
  budowa = zbudujIndeks().then(
    (zbudowany) => {
      if (mojaGeneracja === generacja) indeks = zbudowany
      budowa = null
      return zbudowany
    },
    (err) => {
      budowa = null
      throw err
    },
  )
  return budowa
}

async function zbudujIndeks(): Promise<WierszIndeksu[]> {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })
  const zbudowany: WierszIndeksu[] = []
  let offset = 0
  while (true) {
    const r = await col.get({ limit: BATCH, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    for (const m of r.metadatas) {
      const meta = (m ?? {}) as unknown as ProductMetadata
      if (meta.category !== 'residential') continue
      zbudowany.push({
        name: meta.name,
        colorFamily: meta.color_family,
        hasGlass: meta.has_glass,
        styles: STYLES.filter((s) => (meta as unknown as Record<string, unknown>)['style_' + s] === true),
      })
    }
    offset += r.ids.length
    if (r.ids.length < BATCH) break
  }

  console.log(`[STYLE-INDEX] Zbudowano indeks: ${zbudowany.length} residential`)
  return zbudowany
}

/** Rozgrzewka przy starcie serwera — żeby 3,3 s budowy nie wpadło w pierwsze wyszukiwanie. */
export async function warmStyleIndex(): Promise<void> {
  await getIndeks()
}

export async function countStyles(filters?: HardFilters): Promise<Record<Style, number>> {
  return countStylesIn(await getIndeks(), filters)
}
