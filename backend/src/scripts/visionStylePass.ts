// Przelot wizji po MODELACH: jedno pytanie o styl na model, wynik do pliku
// propozycji. NIE ZAPISUJE NICZEGO DO CHROMY — wizja tu wyłącznie proponuje,
// bo na próbkach rozjeżdżała się z opisem w obie strony (rustykalny 21% katalogu
// wobec 3,6% dziś, ale też trafnie zdejmowała "klasyczny" z płaskiego skrzydła
// z bulajem). Arbitrem jest ekspert domenowy, patrz galeria przeglądu.
// Wznawialny: ponowne uruchomienie pomija modele już rozstrzygnięte.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/visionStylePass.ts
import 'dotenv/config'
import axios from 'axios'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ChromaClient } from 'chromadb'
import { STYLES } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'
import { modelOf } from '../services/glassResolver'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const PLIK = join(__dirname, '..', '..', '..', 'scripts', 'vision_style_proposals.json')
const MODEL_WIZJI = 'google/gemini-2.5-flash'
const WSPOLBIEZNOSC = 4

const PROMPT = `You are a Polish interior-door merchandiser tagging a product photo of ONE door leaf.

Choose EVERY style that genuinely applies, from exactly this list:
klasyczny (raised/moulded panels, mouldings, traditional proportions)
nowoczesny (clean flat leaf, simple lines)
minimalistyczny (no ornament at all, single flat plane)
rustykalny (plank/board look, framed boards, prominent decorative wood grain, knots, barn/farmhouse feel)
loft (black frames, grid glazing, raw industrial look)
skandynawski (pale wood AND deliberately light, airy, simple — not merely "light coloured")
glamour (ornate, luxurious, decorative inlays, gloss, gold/silver accents)

Be strict: assign a style ONLY if the photo actually shows it. Most doors have 1-2 styles.

Output ONLY JSON: {"style": ["..."]}`

interface Propozycja {
  style: string[]
}

function wczytaj(): Record<string, Propozycja> {
  return existsSync(PLIK) ? JSON.parse(readFileSync(PLIK, 'utf-8')) : {}
}

function zapisz(dane: Record<string, Propozycja>): void {
  writeFileSync(PLIK, JSON.stringify(dane, null, 2), 'utf-8')
}

async function zapytajWizje(imageUrl: string): Promise<string[] | null> {
  const res = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: MODEL_WIZJI,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1500,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    },
  )
  const raw = String(res.data.choices[0].message.content)
    .replace(/```(?:json)?/g, '')
    .trim()
  const parsed = JSON.parse(raw) as { style?: unknown }
  if (!Array.isArray(parsed.style)) return null
  // Odsiewamy wszystko spoza taksonomii — model bywa twórczy.
  return parsed.style.filter((s): s is string => (STYLES as readonly unknown[]).includes(s))
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Brak OPENROUTER_API_KEY w backend/.env')
  }
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // Reprezentant modelu = pierwszy wariant ze zdjęciem.
  const reprezentanci = new Map<string, string>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    for (const m of r.metadatas) {
      const meta = (m ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      const img = String(meta.imageUrl ?? '')
      if (!img || categorizeDoor(name) !== 'residential') continue
      const model = modelOf(name)
      if (!reprezentanci.has(model)) reprezentanci.set(model, img)
    }
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  const propozycje = wczytaj()
  const kolejka = [...reprezentanci.entries()].filter(([model]) => !propozycje[model])
  console.log(
    `[WIZJA] Modeli: ${reprezentanci.size}, już rozstrzygniętych: ${Object.keys(propozycje).length}, do zrobienia: ${kolejka.length}`,
  )

  let zrobione = 0
  let bledy = 0
  async function worker() {
    while (kolejka.length > 0) {
      const [model, img] = kolejka.shift()!
      try {
        const style = await zapytajWizje(img)
        if (style) propozycje[model] = { style }
        else bledy++
      } catch (err) {
        bledy++
        console.warn(`[WIZJA] ${model}: ${err instanceof Error ? err.message : err}`)
      }
      zrobione++
      if (zrobione % 20 === 0) {
        zapisz(propozycje)
        console.log(`[WIZJA] ${zrobione}/${zrobione + kolejka.length} (błędów: ${bledy})`)
      }
    }
  }
  await Promise.all(Array.from({ length: WSPOLBIEZNOSC }, worker))
  zapisz(propozycje)

  const licznik: Record<string, number> = {}
  for (const p of Object.values(propozycje)) {
    for (const s of p.style) licznik[s] = (licznik[s] ?? 0) + 1
  }
  console.log(
    `[WIZJA] GOTOWE. Rozstrzygniętych modeli: ${Object.keys(propozycje).length}, błędów: ${bledy}`,
  )
  console.log('[WIZJA] Rozkład propozycji (modeli per styl):', JSON.stringify(licznik))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
