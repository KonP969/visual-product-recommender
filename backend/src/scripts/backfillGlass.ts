// Backfill has_glass z sygnału WIZYJNEGO dla "cichych" modeli.
//
// Powód: opisy/atrybuty powstają z samej NAZWY produktu (nigdy ze zdjęcia),
// więc modele przeszklone, których nazwa nie zawiera "szyba"/"przeszklone"
// (np. PORTA CLASSIC HOME model C.2), lądują błędnie jako has_glass=false.
// CLIP zero-shot nie rozróżnia mlecznej szyby od płyciny — model wizyjny tak.
//
// Strategia (szkło = cecha MODELU, nie koloru → 1 analiza na model):
//   - nazwa zawiera słowo o szkle (GLASS_RE)        → true  (ufamy nazwie)
//   - nazwa zawiera "pełne" (SOLID_NAME_RE)          → false (ufamy nazwie)
//   - pozostałe "ciche" modele                       → Gemini vision na 1 zdjęciu
// Decyzja propagowana na WSZYSTKIE warianty kolorystyczne modelu.
//
// Wznawialny: postęp (model → decyzja) zapisywany na dysk; ponowne uruchomienie
// pomija już rozstrzygnięte modele. Uruchomienie:
//   cd backend && npx ts-node --transpile-only src/scripts/backfillGlass.ts
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import axios from 'axios'
import { ChromaClient } from 'chromadb'
import { GLASS_RE, SOLID_NAME_RE } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'
import { classifyGlassFromImage } from '../services/geminiService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const PROGRESS_FILE = join(__dirname, '..', '..', '..', 'scripts', 'backfill_glass_progress.json')
const CONCURRENCY = 3

interface DbItem {
  id: string
  name: string
  imageUrl: string
  hasGlass: boolean
  meta: Record<string, unknown>
}

type Source = 'name-glass' | 'name-solid' | 'vision' | 'vision-failed'
interface Decision {
  glass: boolean | null
  source: Source
}

const modelOf = (name: string): string => name.split(' - ')[0].trim()

function loadProgress(): Record<string, Decision> {
  try {
    if (existsSync(PROGRESS_FILE)) return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))
  } catch {
    /* zacznij od zera */
  }
  return {}
}

function saveProgress(p: Record<string, Decision>): void {
  mkdirSync(dirname(PROGRESS_FILE), { recursive: true })
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2))
}

async function visionDecision(imageUrl: string): Promise<boolean | null> {
  const res = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: { 'User-Agent': 'VisualProductRecommender/1.0' },
  })
  const buffer = Buffer.from(res.data)
  const ct = String(res.headers['content-type'] ?? '')
  const mimetype = ct.startsWith('image/')
    ? ct
    : imageUrl.toLowerCase().includes('.png')
      ? 'image/png'
      : 'image/jpeg'
  return classifyGlassFromImage(buffer, mimetype)
}

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // --- wczytaj całą bazę
  const items: DbItem[] = []
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = r.metadatas[i] as any
      items.push({
        id,
        name: m.name ?? '',
        imageUrl: m.imageUrl ?? '',
        hasGlass: m.has_glass === true,
        meta: m,
      })
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[GLASS] Baza: ${items.length} produktów`)

  // --- tylko residential; grupuj po modelu
  const residential = items.filter((it) => categorizeDoor(it.name) === 'residential')
  const byModel = new Map<string, DbItem[]>()
  for (const it of residential) {
    const key = modelOf(it.name)
    if (!byModel.has(key)) byModel.set(key, [])
    byModel.get(key)!.push(it)
  }
  console.log(`[GLASS] Residential: ${residential.length} w ${byModel.size} modelach`)

  const progress = loadProgress()

  // --- podziel modele wg źródła decyzji
  const silentModels: string[] = []
  for (const [model, variants] of byModel) {
    if (progress[model]) continue
    const anyGlassName = variants.some((v) => GLASS_RE.test(v.name))
    const anySolidName = variants.some((v) => SOLID_NAME_RE.test(v.name))
    if (anyGlassName) progress[model] = { glass: true, source: 'name-glass' }
    else if (anySolidName) progress[model] = { glass: false, source: 'name-solid' }
    else silentModels.push(model)
  }
  saveProgress(progress)
  console.log(`[GLASS] Ciche modele do wizji: ${silentModels.length}`)

  // Próbny przebieg: GLASS_LIMIT=N ogranicza liczbę modeli wizyjnych.
  const limit = Number(process.env.GLASS_LIMIT ?? 0)
  if (limit > 0 && silentModels.length > limit) {
    // Priorytet dla C.2 w próbce, żeby zweryfikować kluczowy przypadek.
    silentModels.sort((a, b) => Number(b.includes('C.2')) - Number(a.includes('C.2')))
    silentModels.length = limit
    console.log(`[GLASS] GLASS_LIMIT=${limit} — próbny przebieg na ${limit} modelach`)
  }

  // --- wizja na cichych modelach (z ograniczoną współbieżnością)
  let done = 0
  let visionFail = 0
  const queue = [...silentModels]
  async function worker() {
    while (queue.length > 0) {
      const model = queue.shift()!
      const variants = byModel.get(model)!
      const rep = variants.find((v) => v.imageUrl) ?? variants[0]
      try {
        const glass = await visionDecision(rep.imageUrl)
        progress[model] =
          glass === null
            ? { glass: null, source: 'vision-failed' }
            : { glass, source: 'vision' }
        if (glass === null) visionFail++
      } catch (err) {
        progress[model] = { glass: null, source: 'vision-failed' }
        visionFail++
        console.warn(`\n[GLASS] wizja padła dla "${model}":`, err instanceof Error ? err.message.slice(0, 100) : err)
      }
      done++
      if (done % 10 === 0) saveProgress(progress)
      process.stdout.write(`\r  wizja ${done}/${silentModels.length} (fail ${visionFail})   `)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  saveProgress(progress)
  console.log(`\n[GLASS] Wizja gotowa. Nierozstrzygnięte: ${visionFail}`)

  // --- zastosuj: aktualizuj has_glass tam, gdzie różni się od decyzji
  const updIds: string[] = []
  const updMetas: Record<string, unknown>[] = []
  let flips = 0
  for (const [model, variants] of byModel) {
    const dec = progress[model]
    if (!dec || dec.glass === null) continue
    for (const v of variants) {
      if (v.hasGlass !== dec.glass) {
        updIds.push(v.id)
        updMetas.push({ ...v.meta, has_glass: dec.glass })
        flips++
      }
    }
  }
  for (let i = 0; i < updIds.length; i += 200) {
    await col.update({ ids: updIds.slice(i, i + 200), metadatas: updMetas.slice(i, i + 200) as any })
  }

  // --- raport
  const bySource: Record<string, number> = {}
  for (const d of Object.values(progress)) bySource[d.source] = (bySource[d.source] ?? 0) + 1
  console.log(`[GLASS] GOTOWE. Zmieniono has_glass w ${flips} rekordach.`)
  console.log('[GLASS] Decyzje wg źródła (per model):')
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${src}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
