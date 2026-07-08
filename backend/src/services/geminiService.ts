import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Jimp } from 'jimp'
import { COLOR_FAMILIES, ColorFamily } from './attributeService'

// Free tier ma limit DZIENNY per model: 2.5-flash-lite i 2.5-flash po ~20/dzień
// (rodzina 2.0 ma limit 0 — wycofana z free tier). Próbujemy modeli po kolei,
// więc dzienny budżet się sumuje.
const MODEL_CHAIN = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']

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

const FILTERS_RULES = `FILTER RULES (for "filters" — these become HARD database filters, so be precise):
- "colors": array of acceptable color families, or null when the customer doesn't constrain color.
  Allowed values ONLY: "white", "black", "grey", "beige", "light_wood", "medium_wood", "dark_wood".
  Lightness ordering (darkest → lightest): black < dark_wood < grey = medium_wood < light_wood < beige < white.
- "glass": true (door MUST have glazing), false (door MUST be solid, NO glass at all), or null (no constraint).

Semantics:
- An explicit color ("czarne", "black") → colors contains ONLY that family (plus a directly adjacent tone ONLY if the customer is vague).
- "pełne", "bez przeszklenia", "bez szyby", "solid" → glass: false
- "ze szkłem", "przeszklone", "z szybą", "witryna" → glass: true
- Relative adjustments: "jaśniejsze" → colors = families strictly LIGHTER than the base description's family; "ciemniejsze" → strictly darker.`

const IMAGE_PROMPT = `You are helping match RESIDENTIAL INTERIOR doors to a room's style.

Look at this interior photo and describe the residential interior door that would best fit this room.

Output a JSON object with exactly three keys:
- "clip_query": an English phrase optimized for CLIP text-to-image search
- "display_pl": a short Polish description of the same door, shown to the customer
- "filters": {"colors": [...], "glass": null} — color families matching your recommendation (1-3 values, the recommended family plus at most adjacent tones); glass is null for photos (don't constrain glazing from a room photo)

${CLIP_QUERY_RULES}

${DISPLAY_PL_RULES}

${FILTERS_RULES}

Output ONLY the JSON object.`

const TEXT_PROMPT = `You are helping match RESIDENTIAL INTERIOR doors to a customer's wish.

The customer described (in Polish or English) the interior door they want. Convert it faithfully — keep every color, finish and style constraint they stated.

The description may contain relative adjustments after "ale" (e.g. "ale jaśniejsze" = but lighter, "ale ciemniejsze" = but darker, "ale bez przeszklenia" = but without glass, "ale klasyczne" = but classic). Apply each adjustment to transform the base description: the output must describe the ADJUSTED door and drop any base attribute the adjustment contradicts (e.g. "czarne drzwi, ale jaśniejsze" → a lighter door such as grey or light oak, NOT black).

Output a JSON object with exactly three keys:
- "clip_query": an English phrase optimized for CLIP text-to-image search
- "display_pl": a short Polish description of the same door, shown back to the customer
- "filters": {"colors": [...] or null, "glass": true/false/null} — derived STRICTLY from the customer's constraints

${CLIP_QUERY_RULES}

${DISPLAY_PL_RULES}

${FILTERS_RULES}

Output ONLY the JSON object.

Customer's description:
`

export interface SearchFilters {
  colors: ColorFamily[] | null
  glass: boolean | null
}

export interface DoorDescription {
  clipQuery: string
  displayPl: string
  filters: SearchFilters
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
const reasonsCache = new Map<string, Record<string, string>>()

// Przy 20 zapytaniach dziennie każdy cache-miss boli — cache przeżywa restarty.
const CACHE_DIR = join(__dirname, '..', '..', '.cache')
const CACHE_FILE = join(CACHE_DIR, 'gemini-cache.json')

function loadCachesFromDisk(): void {
  try {
    if (!existsSync(CACHE_FILE)) return
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as {
      image?: Array<[string, DoorDescription]>
      text?: Array<[string, DoorDescription]>
      reasons?: Array<[string, Record<string, string>]>
    }
    for (const [k, v] of raw.image ?? []) imageCache.set(k, v)
    for (const [k, v] of raw.text ?? []) textCache.set(k, v)
    for (const [k, v] of raw.reasons ?? []) reasonsCache.set(k, v)
    console.log(
      `[GEMINI] Cache loaded: image=${imageCache.size} text=${textCache.size} reasons=${reasonsCache.size}`,
    )
  } catch (err) {
    console.warn('[GEMINI] Cache load failed:', err instanceof Error ? err.message : err)
  }
}

let saveTimer: NodeJS.Timeout | null = null
function persistCachesSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      mkdirSync(CACHE_DIR, { recursive: true })
      writeFileSync(
        CACHE_FILE,
        JSON.stringify({
          image: [...imageCache.entries()],
          text: [...textCache.entries()],
          reasons: [...reasonsCache.entries()],
        }),
      )
    } catch (err) {
      console.warn('[GEMINI] Cache save failed:', err instanceof Error ? err.message : err)
    }
  }, 500)
}

loadCachesFromDisk()

function cacheGet<T>(cache: Map<string, T>, key: string): T | undefined {
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Re-insert to mark as most recently used
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function cacheSet<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
  persistCachesSoon()
}

function parseFilters(raw: unknown): SearchFilters {
  const empty: SearchFilters = { colors: null, glass: null }
  if (!raw || typeof raw !== 'object') return empty
  const f = raw as { colors?: unknown; glass?: unknown }

  let colors: ColorFamily[] | null = null
  if (Array.isArray(f.colors)) {
    const valid = f.colors.filter((c): c is ColorFamily =>
      COLOR_FAMILIES.includes(c as ColorFamily),
    )
    colors = valid.length > 0 ? valid : null
  }
  const glass = typeof f.glass === 'boolean' ? f.glass : null
  return { colors, glass }
}

export function parseDoorDescription(raw: string): DoorDescription {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const parsed = JSON.parse(cleaned) as {
    clip_query?: string
    display_pl?: string
    filters?: unknown
  }
  const clipQuery = parsed.clip_query?.trim()
  const displayPl = parsed.display_pl?.trim()
  if (!clipQuery) {
    throw new Error('Gemini returned no clip_query')
  }
  return {
    clipQuery,
    displayPl: displayPl || clipQuery,
    filters: parseFilters(parsed.filters),
  }
}

const RETRY_DELAY_MS = 1_500

function isDailyQuotaError(message: string): boolean {
  return message.includes('PerDay') || (message.includes('429') && message.includes('limit: 0'))
}

async function generateJson(
  parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>,
): Promise<string> {
  const attempt = async (modelName: string): Promise<string> => {
    const model = getClient().getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: 'application/json' },
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timeout after ${GEMINI_TIMEOUT_MS / 1000}s`)), GEMINI_TIMEOUT_MS),
    )
    const result = await Promise.race([model.generateContent(parts), timeoutPromise])
    return result.response.text()
  }

  // Dzienny limit per model → przy jego wyczerpaniu przechodzimy do kolejnego
  // modelu w łańcuchu. 503/429-minutowe są przejściowe — 429 podaje ile czekać
  // ("Please retry in 19.8s"), honorujemy to zamiast zgadywać.
  const MAX_ATTEMPTS = 3
  let lastError: unknown
  for (const modelName of MODEL_CHAIN) {
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      try {
        return await attempt(modelName)
      } catch (err) {
        lastError = err
        const message = err instanceof Error ? err.message : String(err)
        if (isDailyQuotaError(message)) {
          console.warn(`[GEMINI] ${modelName}: dzienny limit wyczerpany, próbuję następny model`)
          break // następny model w łańcuchu
        }
        if (i === MAX_ATTEMPTS) break
        let delay = RETRY_DELAY_MS
        const retryIn = message.match(/retry in (\d+(?:\.\d+)?)s/i)
        if (retryIn) {
          delay = Math.min(Math.ceil(parseFloat(retryIn[1]) + 2) * 1000, 65_000)
        }
        console.warn(`[GEMINI] ${modelName} attempt ${i} failed, retry in ${delay / 1000}s:`, message.slice(0, 100))
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastError
}

async function generateWithTimeout(
  parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>,
): Promise<DoorDescription> {
  return parseDoorDescription(await generateJson(parts))
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

export interface MatchCandidate {
  id: string
  name: string
  description: string
}

export function parseMatchReasons(
  raw: string,
  candidates: MatchCandidate[],
): Record<string, string> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const parsed = JSON.parse(cleaned) as Array<{ i?: number; why?: string }>
  if (!Array.isArray(parsed)) throw new Error('Gemini returned non-array reasons')

  const reasons: Record<string, string> = {}
  for (const item of parsed) {
    const idx = typeof item.i === 'number' ? item.i - 1 : -1
    const why = item.why?.trim()
    if (idx >= 0 && idx < candidates.length && why) {
      reasons[candidates[idx].id] = why
    }
  }
  return reasons
}

const REASONS_PROMPT_HEAD = `You are an interior design assistant. The customer's room needs a door matching this style (internal English query):

`

const REASONS_PROMPT_RULES = `

For each numbered product below, write ONE short Polish sentence explaining why it fits that style — point at a concrete visual link (color, finish, glass, panel style). Do not repeat the product name. Lowercase start, max 14 words.

Output ONLY a JSON array: [{"i": <product number as int>, "why": "<Polish sentence>"}]

Products:
`

// Explains, per product, why it matches the room — shown on card hover.
// Runs AFTER results are sent, so it never delays the search itself.
export async function explainMatches(
  clipQuery: string,
  candidates: MatchCandidate[],
): Promise<Record<string, string>> {
  if (candidates.length === 0) return {}

  const key = clipQuery + '|' + candidates.map((c) => c.id).join(',')
  const cached = cacheGet(reasonsCache, key)
  if (cached) {
    console.log('[GEMINI] Match reasons cache hit')
    return cached
  }

  const productLines = candidates
    .map((c, i) => `${i + 1}. ${c.name}${c.description ? ` | ${c.description}` : ''}`)
    .join('\n')
  const prompt = REASONS_PROMPT_HEAD + `"${clipQuery}"` + REASONS_PROMPT_RULES + productLines

  const reasons = parseMatchReasons(await generateJson([{ text: prompt }]), candidates)
  cacheSet(reasonsCache, key, reasons)
  return reasons
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
