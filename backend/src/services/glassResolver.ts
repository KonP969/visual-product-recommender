// Wizyjne rozstrzyganie has_glass dla NOWO dodanych produktów — wołane na końcu
// syncCatalog i importu z UI. Szkło = cecha MODELU, nie koloru: 1 decyzja na
// model propagowana na warianty. Import zapisuje has_glass tekstowo (classifyDoor);
// ta funkcja tylko KORYGUJE tam, gdzie nazwa/reuse/wizja dają pewniejszą odpowiedź.
// Pad wizji → brak korekty → zostaje wartość tekstowa (import się nie wysypie).
import axios from 'axios'
import { ChromaClient } from 'chromadb'
import { GLASS_RE, SOLID_NAME_RE } from './attributeService'
import { categorizeDoor } from './chromaService'
import { classifyGlassFromImage } from './geminiService'
import { overrideFor } from './overrides'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const CONCURRENCY = 3

export interface NowyProdukt {
  id: string
  name: string
  imageUrl: string
}

export interface WynikResolve {
  visionCalls: number
  flips: number
  failed: number
}

export function modelOf(name: string): string {
  return name.split(' - ')[0].trim()
}

// Decyzja o szkle wyłącznie z NAZW wariantów modelu.
// null = "cichy" model — nazwa nie rozstrzyga (trzeba reuse lub wizji).
export function decideGlassFromName(names: string[]): boolean | null {
  if (names.some((n) => GLASS_RE.test(n))) return true
  if (names.some((n) => SOLID_NAME_RE.test(n))) return false
  return null
}

/**
 * Szkło modelu z uwzględnieniem tabeli korekt. Korekta ZASTĘPUJE decyzję automatu,
 * bo dla części modeli packshot jej nie niesie: przy VERTE PREMIUM E.4 (cztery
 * wąskie pasy szkła satynowego) cztery różne rodziny modeli wizyjnych zgodnie
 * orzekają "listwa metalowa". Tu wygrywa wiedza eksperta domenowego.
 */
export function glassForModelName(modelName: string, decyzja: boolean | null): boolean | null {
  const korekta = overrideFor(modelName)
  if (korekta?.hasGlass !== undefined) return korekta.hasGlass
  return decyzja
}

// Pobiera obraz i pyta model wizyjny. Zwraca null przy niepewności/błędzie.
export async function visionDecision(imageUrl: string): Promise<boolean | null> {
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

/**
 * Koryguje has_glass dla nowo dodanych produktów. Zakłada, że rekordy są już
 * w Chromie (import je zapisał z has_glass tekstowym). Grupuje po modelu,
 * rozstrzyga: nazwa → reuse z istniejących → wizja. Aktualizuje tylko różnice.
 */
export async function resolveGlassForProducts(nowe: NowyProdukt[]): Promise<WynikResolve> {
  const result: WynikResolve = { visionCalls: 0, flips: 0, failed: 0 }
  const residential = nowe.filter((p) => categorizeDoor(p.name) === 'residential')
  if (residential.length === 0) return result

  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // Jeden odczyt całej kolekcji: (a) mapa model→has_glass z ISTNIEJĄCYCH rekordów
  // (reuse — Chroma nie filtruje po prefiksie nazwy), (b) metadane NOWYCH rekordów
  // (potrzebne do update). newIds oddziela "istniejące rodzeństwo" od świeżo dodanych.
  const newIds = new Set(residential.map((p) => p.id))
  const existingByModel = new Map<string, boolean>()
  const newMeta = new Map<string, Record<string, unknown>>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = (r.metadatas[i] ?? {}) as Record<string, unknown>
      if (newIds.has(id)) {
        newMeta.set(id, m)
      } else {
        const model = modelOf(String(m.name ?? ''))
        if (!existingByModel.has(model) && typeof m.has_glass === 'boolean') {
          existingByModel.set(model, m.has_glass as boolean)
        }
      }
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  // Grupuj nowe po modelu
  const byModel = new Map<string, NowyProdukt[]>()
  for (const p of residential) {
    const key = modelOf(p.name)
    if (!byModel.has(key)) byModel.set(key, [])
    byModel.get(key)!.push(p)
  }

  // Rozstrzygnij decyzję per model: nazwa → reuse → (wizja później)
  const decisions = new Map<string, boolean>()
  const silent: string[] = []
  for (const [model, variants] of byModel) {
    const fromName = decideGlassFromName(variants.map((v) => v.name))
    if (fromName !== null) {
      decisions.set(model, fromName)
    } else if (existingByModel.has(model)) {
      decisions.set(model, existingByModel.get(model)!)
    } else {
      silent.push(model)
    }
  }

  // Wizja na cichych modelach (współbieżność CONCURRENCY)
  const queue = [...silent]
  async function worker() {
    while (queue.length > 0) {
      const model = queue.shift()!
      const variants = byModel.get(model)!
      const rep = variants.find((v) => v.imageUrl) ?? variants[0]
      if (!rep.imageUrl) {
        result.failed++
        continue
      }
      try {
        const glass = await visionDecision(rep.imageUrl)
        result.visionCalls++
        if (glass === null) {
          result.failed++
          continue
        }
        decisions.set(model, glass)
      } catch {
        result.failed++
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // Zastosuj: update has_glass na nowych rekordach, gdzie różni się od decyzji.
  const updIds: string[] = []
  const updMetas: Record<string, unknown>[] = []
  for (const [model, variants] of byModel) {
    // Korekta obowiązuje nawet dla modeli, których automat nie rozstrzygnął
    // (brak wpisu w decisions) — dlatego pytamy ją PRZED sprawdzeniem decisions.
    const glass = glassForModelName(model, decisions.has(model) ? decisions.get(model)! : null)
    if (glass === null) continue
    for (const v of variants) {
      const meta = newMeta.get(v.id)
      if (meta && meta.has_glass !== glass) {
        updIds.push(v.id)
        updMetas.push({ ...meta, has_glass: glass })
        result.flips++
      }
    }
  }
  for (let i = 0; i < updIds.length; i += 200) {
    await col.update({ ids: updIds.slice(i, i + 200), metadatas: updMetas.slice(i, i + 200) as any })
  }

  return result
}
