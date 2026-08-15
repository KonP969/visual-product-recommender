import { createHash } from 'crypto'
import { Router, Response } from 'express'
import multer from 'multer'
import { getEmbedding, getTextEmbedding } from '../services/clipService'
import { searchSimilar, SearchResultItem } from '../services/chromaService'
import {
  describeRoomForDoorMatching,
  describeDoorFromText,
  explainMatches,
  DoorDescription,
} from '../services/geminiService'
import {
  explicitColorFromQuery,
  explicitWoodFromQuery,
  explicitFinishFromQuery,
  explicitStyleFromQuery,
  STYLES,
} from '../services/attributeService'
import type { Style } from '../services/attributeService'
import { buildNotice, resolveStyleFilter } from './searchNotices'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type'))
    }
  },
})

export const searchRouter = Router()

// "Doładuj kolejne": frontend wysyła nazwy już pokazanych produktów, żeby
// kolejna strona wyników ich nie powtórzyła. Multipart (/search) wysyła to
// jako JSON-string pola formularza; JSON (/search-text) — jako gotową tablicę.
function parseExcludeNames(raw: unknown): Set<string> | undefined {
  if (Array.isArray(raw)) {
    const names = raw.filter((x): x is string => typeof x === 'string')
    return names.length > 0 ? new Set(names) : undefined
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseExcludeNames(JSON.parse(raw))
    } catch {
      return undefined
    }
  }
  return undefined
}

function parseResultCount(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : fallback
}

function toProducts(results: SearchResultItem[]) {
  return results.map((r) => ({
    id: r.id,
    name: r.metadata.name,
    price: r.metadata.price,
    imageUrl: r.metadata.imageUrl,
    productUrl: r.metadata.productUrl,
    similarity: r.similarity,
    description: r.metadata.description,
    colorFamily: r.metadata.color_family,
    hasGlass: r.metadata.has_glass,
    variantCount: r.variantCount,
    priceFrom: r.priceFrom,
  }))
}

function buildResultPayload(
  description: DoorDescription | null,
  results: SearchResultItem[],
  isLowSimilarity: boolean,
  droppedFinish?: string,
  droppedStyle?: Style,
  styleCounts?: Record<Style, number>,
) {
  const notice = buildNotice(droppedFinish, droppedStyle)
  if (results.length === 0) {
    return {
      products: [],
      description: description?.clipQuery,
      displayDescription: description?.displayPl,
      status: 'empty-catalog' as const,
      notice,
      styleCounts,
    }
  }
  return {
    products: toProducts(results),
    description: description?.clipQuery,
    displayDescription: description?.displayPl,
    status: isLowSimilarity ? ('low-similarity' as const) : ('success' as const),
    notice,
    styleCounts,
  }
}

function ndjson(res: Response): (event: object) => void {
  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  return (event: object) => {
    res.write(JSON.stringify(event) + '\n')
  }
}

// Per-product "why it matches" arrives as a follow-up event so it never
// delays the results themselves.
async function sendMatchReasons(
  send: (event: object) => void,
  description: DoorDescription | null,
  results: SearchResultItem[],
): Promise<void> {
  if (!description || results.length === 0) return
  try {
    const reasons = await explainMatches(
      description.clipQuery,
      results.map((r) => ({
        id: r.id,
        name: r.metadata.name,
        description: r.metadata.description ?? '',
      })),
    )
    if (Object.keys(reasons).length > 0) {
      send({ type: 'reasons', data: reasons })
    }
  } catch (err) {
    console.warn('[SEARCH] Match reasons failed:', err instanceof Error ? err.message : err)
  }
}

// Streams NDJSON: progress stages, then the result, then per-product reasons.
searchRouter.post('/search', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image provided' })
    return
  }

  const send = ndjson(res)

  try {
    const fileSizeKB = Math.round(req.file.buffer.length / 1024)
    console.log(`[SEARCH] Image received: ${req.file.mimetype}, ${fileSizeKB} KB`)

    send({ type: 'progress', stage: 'analyzing' })
    // Gemini being down must not take search down with it — fall back to the
    // original image→CLIP pipeline (cross-modal, weaker but always available).
    let description: DoorDescription | null = null
    try {
      description = await describeRoomForDoorMatching(req.file.buffer, req.file.mimetype)
      console.log(`[SEARCH] Gemini: clip="${description.clipQuery}" pl="${description.displayPl}"`)
    } catch (err) {
      console.warn(
        '[SEARCH] Gemini failed, falling back to image embedding:',
        err instanceof Error ? err.message : err,
      )
    }

    send({ type: 'progress', stage: 'matching' })
    const embedding = description
      ? await getTextEmbedding(description.clipQuery)
      : await getEmbedding(req.file.buffer, req.file.mimetype)
    if (description) {
      console.log(`[SEARCH] Filters: ${JSON.stringify(description.filters)}`)
    }
    // Seed z hasha zdjęcia: dwa podobne wnętrza tasują remisy inaczej,
    // a to samo zdjęcie zawsze dostaje te same wyniki.
    const seed = createHash('sha256').update(req.file.buffer).digest('hex')

    // Liczniki chipów liczymy zawsze — front wygasza style bez trafień, zanim
    // użytkownik w nie kliknie. Decyzja o ewentualnym pominięciu stylu (i drugie,
    // tanie przeliczenie bez finish, gdy finish akurat wyzerował całą pulę) żyje
    // w resolveStyleFilter — patrz F1/F5 w searchNotices.ts.
    const { styleCounts, filters, droppedStyle } = await resolveStyleFilter(description?.filters)
    if (droppedStyle) {
      console.warn(`[SEARCH] Brak drzwi w stylu "${droppedStyle}" — pomijam filtr`)
    }
    const excludeNames = parseExcludeNames(req.body?.excludeNames)
    const n = parseResultCount(req.body?.n, 10)
    const { results, isLowSimilarity } = await searchSimilar(
      embedding,
      n,
      filters,
      seed,
      undefined,
      excludeNames,
    )
    console.log(`[SEARCH] Got ${results.length} results, isLowSimilarity=${isLowSimilarity}`)

    const payload = buildResultPayload(
      description,
      results,
      isLowSimilarity,
      undefined,
      droppedStyle,
      styleCounts,
    )

    // Odważna alternatywa projektanta: przychodzi w TYM SAMYM wywołaniu Gemini,
    // więc kosztuje tylko jeden embedding (sidecar) i jedno query do Chroma.
    // Przy doładowaniu kolejnych (excludeNames) front już ją ma i nie renderuje
    // ponownie — pomijamy, żeby nie płacić za policzenie czegoś niewidocznego.
    let wildcard: object | null = null
    if (!excludeNames && description?.wild && results.length > 0) {
      try {
        const wildEmbedding = await getTextEmbedding(description.wild.clipQuery)
        const seen = new Set(results.map((r) => r.id))
        // Odważna alternatywa ma być kontrastowa — nie ograniczaj jej stylem.
        const wildFilters = description.wild.filters
          ? { ...description.wild.filters, style: null }
          : description.wild.filters
        const { results: wildResults } = await searchSimilar(wildEmbedding, 8, wildFilters, seed)
        const unique = wildResults.filter((r) => !seen.has(r.id)).slice(0, 4)
        if (unique.length > 0) {
          wildcard = {
            displayDescription: description.wild.displayPl,
            why: description.wild.whyPl,
            products: toProducts(unique),
          }
          console.log(`[SEARCH] Wildcard: "${description.wild.displayPl}" (${unique.length} szt.)`)
        }
      } catch (err) {
        console.warn('[SEARCH] Wildcard failed:', err instanceof Error ? err.message : err)
      }
    }

    send({ type: 'result', data: { ...payload, wildcard } })
    await sendMatchReasons(send, description, results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    console.error('[SEARCH] Error:', message)
    send({ type: 'error', error: message })
  }
  res.end()
})

// Text refinement: user edits the description and re-searches without
// re-uploading. Same NDJSON stream shape as /search.
searchRouter.post('/search-text', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : ''
  if (!query) {
    res.status(400).json({ error: 'No query provided' })
    return
  }

  const send = ndjson(res)

  try {
    send({ type: 'progress', stage: 'analyzing' })
    const description = await describeDoorFromText(query)
    console.log(`[SEARCH-TEXT] "${query}" -> clip="${description.clipQuery}"`)

    // Deterministyczny guard: jawnie nazwany pojedynczy kolor przebija LLM,
    // który bywa zbyt liberalny (np. "czarne" → dorzuca dark_wood).
    // Guard bada TYLKO słowa użytkownika (chip/wpis), nie zamrożoną bazę: baza to
    // parafraza wnętrza ("jasne drzwi dębowe...") i jej "jasne" fałszywie łapało
    // RELATIVE_OR_VAGUE_RE, kasując dopisany przez usera kolor ("drzwi czarne").
    const rawRefinement = req.body?.refinement
    const guardText =
      typeof rawRefinement === 'string' && rawRefinement.trim() ? rawRefinement : query
    const explicitColors = explicitColorFromQuery(guardText)
    if (explicitColors) {
      description.filters = { ...description.filters, colors: explicitColors }
      console.log(`[SEARCH-TEXT] Guard: wymuszono kolor ${JSON.stringify(explicitColors)}`)
    } else {
      // Materiał: "drzwi dębowe" / "drewno naturalne" nie nazywają odcienia, więc
      // guard koloru milczy — a wtedy LLM trzymał kolor bazy ("białe") i gubił
      // prośbę o drewno. Cała paleta drewna zamiast biele.
      const woodColors = explicitWoodFromQuery(guardText)
      if (woodColors) {
        description.filters = { ...description.filters, colors: woodColors }
        console.log(`[SEARCH-TEXT] Guard: wymuszono drewno ${JSON.stringify(woodColors)}`)
      }
    }

    // Wybarwienie: gatunek nazwany wprost ("orzech", "dębowe"). Rodzina koloru
    // jest zbyt zgrubna — dark_wood miesza orzech z dębem ciemnym i mokką.
    const finish = explicitFinishFromQuery(guardText)
    if (finish) {
      description.filters = { ...description.filters, finish }
      console.log(`[SEARCH-TEXT] Guard: wymuszono wybarwienie ${finish}`)
    }

    // Styl: jawne pole z chipa (frontend) przebija tekst; brak → guard z tekstu.
    // body.style pochodzi z publicznego endpointu — waliduj wobec STYLES.
    const rawStyle = req.body?.style
    const bodyStyle =
      typeof rawStyle === 'string' && (STYLES as readonly string[]).includes(rawStyle)
        ? (rawStyle as Style)
        : null
    const style = bodyStyle ?? explicitStyleFromQuery(query)
    if (style) {
      description.filters = { ...description.filters, style }
      console.log(`[SEARCH-TEXT] Guard: wymuszono styl ${style}`)
    }

    send({ type: 'progress', stage: 'matching' })
    const embedding = await getTextEmbedding(description.clipQuery)
    console.log(`[SEARCH-TEXT] Filters: ${JSON.stringify(description.filters)}`)
    const seed = createHash('sha256').update(query).digest('hex')

    // Patrz komentarz w /search: resolveStyleFilter decyduje wobec filtrów, które
    // faktycznie trafią do searchSimilar — nie wobec liczników wyzerowanych przez
    // finish (miękki filtr). Bez tego $or [styl, style_none] degeneruje do garstki
    // drzwi bezstylowych, które ze stylem nie mają nic wspólnego (zgłoszenie:
    // „pokazuje stalowe").
    const { styleCounts, filters, droppedStyle } = await resolveStyleFilter(description.filters)
    if (droppedStyle) {
      console.warn(`[SEARCH-TEXT] Brak drzwi w stylu "${droppedStyle}" — pomijam filtr`)
    }

    const excludeNames = parseExcludeNames(req.body?.excludeNames)
    const n = parseResultCount(req.body?.n, 10)
    const { results, isLowSimilarity, droppedFinish } = await searchSimilar(
      embedding,
      n,
      filters,
      seed,
      undefined,
      excludeNames,
    )

    send({
      type: 'result',
      data: buildResultPayload(
        description,
        results,
        isLowSimilarity,
        droppedFinish,
        droppedStyle,
        styleCounts,
      ),
    })
    await sendMatchReasons(send, description, results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    console.error('[SEARCH-TEXT] Error:', message)
    send({ type: 'error', error: message })
  }
  res.end()
})
