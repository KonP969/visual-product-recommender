import { createHash } from 'crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Jimp } from 'jimp'

const MODEL_NAME = 'gemini-2.5-flash'

const CLIP_QUERY_RULES = `CLIP QUERY RULES (for "clip_query"):
- The phrase MUST START with the dominant door color (e.g. "white", "black", "dark walnut", "light oak", "grey").
- Repeat the color or tonal family at least once more in the phrase to emphasize it (e.g. "black dark matte ... black door").
- Then include: finish (matte / gloss / wood grain) and style (modern flat panel / classic raised panel / minimalist / rustic / glass).
- ALWAYS include the word "residential" in the phrase — this is never a security, acoustic, fire-rated, or steel entrance door.
- For loft or industrial-style interiors, use "residential loft" — NOT just "industrial" (which implies commercial steel doors).
- Max 18 words, English, no punctuation other than commas.

Examples of good clip_query values:
black dark matte flat panel modern minimalist residential black interior door
white bright matte minimalist flat panel modern residential white interior door
dark walnut warm wood grain classic raised panel residential walnut door`

const DISPLAY_PL_RULES = `DISPLAY RULES (for "display_pl"):
- A short, natural Polish phrase a customer would read, describing the same door (color, finish, style).
- No repetitions, no technical jargon, lowercase, max 12 words.

Examples of good display_pl values:
czarne, matowe, nowoczesne drzwi o minimalistycznym designie
białe, matowe drzwi w stylu minimalistycznym
drzwi w kolorze ciemnego orzecha, klasyczne, z wyraźnym usłojeniem`

const IMAGE_PROMPT = `You are helping match RESIDENTIAL INTERIOR doors to a room's style.

Look at this interior photo and describe the residential interior door that would best fit this room.

Output a JSON object with exactly two keys:
- "clip_query": an English phrase optimized for CLIP text-to-image search
- "display_pl": a short Polish description of the same door, shown to the customer

${CLIP_QUERY_RULES}

${DISPLAY_PL_RULES}

Output ONLY the JSON object.`

const TEXT_PROMPT = `You are helping match RESIDENTIAL INTERIOR doors to a customer's wish.

The customer described (in Polish or English) the interior door they want. Convert it faithfully — keep every color, finish and style constraint they stated.

The description may contain relative adjustments after "ale" (e.g. "ale jaśniejsze" = but lighter, "ale ciemniejsze" = but darker, "ale bez przeszklenia" = but without glass, "ale klasyczne" = but classic). Apply each adjustment to transform the base description: the output must describe the ADJUSTED door and drop any base attribute the adjustment contradicts (e.g. "czarne drzwi, ale jaśniejsze" → a lighter door such as grey or light oak, NOT black).

Output a JSON object with exactly two keys:
- "clip_query": an English phrase optimized for CLIP text-to-image search
- "display_pl": a short Polish description of the same door, shown back to the customer

${CLIP_QUERY_RULES}

${DISPLAY_PL_RULES}

Output ONLY the JSON object.

Customer's description:
`

export interface DoorDescription {
  clipQuery: string
  displayPl: string
}

let client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (client) return client
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY not set — copy backend/.env.example to backend/.env and fill it in')
  }
  client = new GoogleGenerativeAI(key)
  return client
}

const GEMINI_TIMEOUT_MS = 30_000

// Gemini free tier allows only a few hundred requests per day, so identical
// inputs (same photo re-searched, same refinement text) must not burn quota.
const CACHE_MAX = 200
const imageCache = new Map<string, DoorDescription>()
const textCache = new Map<string, DoorDescription>()

function cacheGet(cache: Map<string, DoorDescription>, key: string): DoorDescription | undefined {
  const hit = cache.get(key)
  if (hit) {
    // Re-insert to mark as most recently used
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function cacheSet(cache: Map<string, DoorDescription>, key: string, value: DoorDescription): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

export function parseDoorDescription(raw: string): DoorDescription {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const parsed = JSON.parse(cleaned) as { clip_query?: string; display_pl?: string }
  const clipQuery = parsed.clip_query?.trim()
  const displayPl = parsed.display_pl?.trim()
  if (!clipQuery) {
    throw new Error('Gemini returned no clip_query')
  }
  return { clipQuery, displayPl: displayPl || clipQuery }
}

async function generateWithTimeout(
  parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>,
): Promise<DoorDescription> {
  const model = getClient().getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: { responseMimeType: 'application/json' },
  })

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini timeout after ${GEMINI_TIMEOUT_MS / 1000}s`)), GEMINI_TIMEOUT_MS),
  )

  const result = await Promise.race([model.generateContent(parts), timeoutPromise])
  return parseDoorDescription(result.response.text())
}

// Downscale large photos before base64-encoding: Gemini doesn't need more than
// ~1024px to judge room style, and smaller payloads upload noticeably faster.
const RESIZE_THRESHOLD_BYTES = 1_500_000
const MAX_DIMENSION = 1024

async function prepareImage(
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; mimetype: string }> {
  if (buffer.length <= RESIZE_THRESHOLD_BYTES) {
    return { buffer, mimetype }
  }
  try {
    const image = await Jimp.read(buffer)
    if (Math.max(image.width, image.height) > MAX_DIMENSION) {
      image.scaleToFit({ w: MAX_DIMENSION, h: MAX_DIMENSION })
    }
    const resized = await image.getBuffer('image/jpeg', { quality: 85 })
    console.log(`[GEMINI] Downscaled image ${Math.round(buffer.length / 1024)} KB -> ${Math.round(resized.length / 1024)} KB`)
    return { buffer: Buffer.from(resized), mimetype: 'image/jpeg' }
  } catch (err) {
    console.warn('[GEMINI] Image downscale failed, sending original:', err instanceof Error ? err.message : err)
    return { buffer, mimetype }
  }
}

export async function describeRoomForDoorMatching(
  imageBuffer: Buffer,
  mimetype: string,
): Promise<DoorDescription> {
  const key = createHash('sha256').update(imageBuffer).digest('hex')
  const cached = cacheGet(imageCache, key)
  if (cached) {
    console.log('[GEMINI] Image description cache hit')
    return cached
  }

  const prepared = await prepareImage(imageBuffer, mimetype)
  const description = await generateWithTimeout([
    { text: IMAGE_PROMPT },
    {
      inlineData: {
        data: prepared.buffer.toString('base64'),
        mimeType: prepared.mimetype,
      },
    },
  ])
  cacheSet(imageCache, key, description)
  return description
}

export async function describeDoorFromText(userQuery: string): Promise<DoorDescription> {
  const key = userQuery.trim().toLowerCase()
  const cached = cacheGet(textCache, key)
  if (cached) {
    console.log('[GEMINI] Text description cache hit')
    return cached
  }

  const description = await generateWithTimeout([{ text: TEXT_PROMPT + userQuery }])
  cacheSet(textCache, key, description)
  return description
}
