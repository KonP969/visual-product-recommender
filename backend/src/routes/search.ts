import { Router } from 'express'
import multer from 'multer'
import { getEmbedding, getTextEmbedding } from '../services/clipService'
import { searchSimilar, SearchResultItem } from '../services/chromaService'
import { describeRoomForDoorMatching, describeDoorFromText, DoorDescription } from '../services/geminiService'

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

// Streams NDJSON progress events followed by the final result, so the UI can
// show which pipeline stage (Gemini analysis vs vector matching) is running.
searchRouter.post('/search', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image provided' })
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  const send = (event: object) => {
    res.write(JSON.stringify(event) + '\n')
  }

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
    const { results, isLowSimilarity } = await searchSimilar(embedding, 10)
    console.log(`[SEARCH] Got ${results.length} results, isLowSimilarity=${isLowSimilarity}`)

    send({ type: 'result', data: buildResultPayload(description, results, isLowSimilarity) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    console.error('[SEARCH] Error:', message)
    send({ type: 'error', error: message })
  }
  res.end()
})

// Text refinement: user edits the description and re-searches without re-uploading.
searchRouter.post('/search-text', async (req, res, next) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : ''
    if (!query) {
      res.status(400).json({ error: 'No query provided' })
      return
    }

    const description = await describeDoorFromText(query)
    console.log(`[SEARCH-TEXT] "${query}" -> clip="${description.clipQuery}"`)

    const embedding = await getTextEmbedding(description.clipQuery)
    const { results, isLowSimilarity } = await searchSimilar(embedding, 10)

    res.json(buildResultPayload(description, results, isLowSimilarity))
  } catch (err) {
    next(err)
  }
})
