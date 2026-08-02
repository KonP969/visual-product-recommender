// Liczniki trafień per styl dla chipów: „ile jest białych klasycznych" liczymy
// z lekkiego indeksu metadanych w pamięci (wzorzec nameIndex z chromaService).
// Zmierzone: 7 zapytań do Chromy z where kosztuje 330–375 ms na wyszukiwanie,
// skan indeksu 71 ms. Indeks unieważnia import/sync/backfill (styleResolver).
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

export function invalidateStyleIndex(): void {
  indeks = null
}

async function getIndeks(): Promise<WierszIndeksu[]> {
  if (indeks) return indeks

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

  indeks = zbudowany
  console.log(`[STYLE-INDEX] Zbudowano indeks: ${zbudowany.length} residential`)
  return zbudowany
}

export async function countStyles(filters?: HardFilters): Promise<Record<Style, number>> {
  return countStylesIn(await getIndeks(), filters)
}
