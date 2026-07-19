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
import { explicitColorFromQuery, explicitStyleFromQuery } from '../services/attributeService'

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
  }))
}

function buildResultPayload(
  description: DoorDescription | null,
  results: SearchResultItem[],
  isLowSimilarity: boolean,
) {
  if (results.length === 0) {
    return {
      products: [],
      description: description?.clipQuery,
      displayDescription: description?.displayPl,
      status: 'empty-catalog' as const,
    }
  }
  return {
    products: toProducts(results),
    description: description?.clipQuery,
    displayDescription: description?.displayPl,
    status: isLowSimilarity ? ('low-similarity' as const) : ('success' as const),
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
    const { results, isLowSimilarity } = await searchSimilar(embedding, 10, description?.filters, seed)
    console.log(`[SEARCH] Got ${results.length} results, isLowSimilarity=${isLowSimilarity}`)

    const payload = buildResultPayload(description, results, isLowSimilarity)

    // Odważna alternatywa projektanta: przychodzi w TYM SAMYM wywołaniu Gemini,
    // więc kosztuje tylko jeden embedding (sidecar) i jedno query do Chroma.
    let wildcard: object | null = null
    if (description?.wild && results.length > 0) {
      try {
        const wildEmbedding = await getTextEmbedding(description.wild.clipQuery)
        const seen = new Set(results.map((r) => r.id))
        const { results: wildResults } = await searchSimilar(wildEmbedding, 8, description.wild.filters, seed)
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
    const explicitColors = explicitColorFromQuery(query)
    if (explicitColors) {
      description.filters = { ...description.filters, colors: explicitColors }
      console.log(`[SEARCH-TEXT] Guard: wymuszono kolor ${JSON.stringify(explicitColors)}`)
    }

    // Styl: jawne pole z chipa (frontend) przebija tekst; brak → guard z tekstu.
    const bodyStyle = typeof req.body?.style === 'string' ? req.body.style : null
    const style = bodyStyle ?? explicitStyleFromQuery(query)
    if (style) {
      description.filters = { ...description.filters, style: style as any }
      console.log(`[SEARCH-TEXT] Guard: wymuszono styl ${style}`)
    }

    send({ type: 'progress', stage: 'matching' })
    const embedding = await getTextEmbedding(description.clipQuery)
    console.log(`[SEARCH-TEXT] Filters: ${JSON.stringify(description.filters)}`)
    const seed = createHash('sha256').update(query).digest('hex')
    const { results, isLowSimilarity } = await searchSimilar(embedding, 10, description.filters, seed)

    send({ type: 'result', data: buildResultPayload(description, results, isLowSimilarity) })
    await sendMatchReasons(send, description, results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    console.error('[SEARCH-TEXT] Error:', message)
    send({ type: 'error', error: message })
  }
  res.end()
})
