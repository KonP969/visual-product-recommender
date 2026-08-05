// Utrzymuje styl jako cechę MODELU przy imporcie — bliźniak glassResolver, ale
// bez wizji i bez Gemini (styl czytamy z opisu EN). Nowy wariant koloru nie może
// rozjechać stylu modelu: przeliczamy głosy ze WSZYSTKICH wariantów, także tych
// już leżących w bazie, i zapisujemy identyczne flagi całej rodzinie.
import { ChromaClient } from 'chromadb'
import { aggregateStyles, classifyStyles, styleFlags } from './attributeService'
import type { Style } from './attributeService'
import { categorizeDoor } from './chromaService'
import { modelOf } from './glassResolver'
import { overrideFor } from './overrides'
import { invalidateStyleIndex } from './styleIndex'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const BATCH = 500

export interface WynikStylu {
  models: number
  updated: number
}

/**
 * Opisy wariantów jednego modelu → style modelu. Czysta, bez sieci.
 *
 * Puste opisy (import z UI jest obrazkowy — importService.ts nigdy nie zapisuje
 * `description`) pomijamy PRZED głosowaniem. Gdyby liczyły się do mianownika
 * (perVariant.length w aggregateStyles), rozwadniałyby większość i dla modeli
 * WIELOETYKIETOWYCH potrafiły zdjąć styl, który realnie ma poparcie (F3).
 * Model, którego WSZYSTKIE warianty nie mają opisu, nadal wypada jako
 * style_none — to jest poprawny wynik, nie awaria.
 */
export function stylesForModel(descriptions: string[]): Style[] {
  const niepuste = descriptions.filter((d) => d.trim())
  return aggregateStyles(niepuste.map((d) => classifyStyles(d)))
}

/**
 * Styl modelu z uwzględnieniem tabeli korekt. Korekta ZASTĘPUJE głosowanie —
 * ekspert domenowy widzi drzwi, których opis EN nie oddaje (VIGO/CRAFT/VALLO
 * to wizualnie deski, a opis mówi "modern flat panel").
 */
export function stylesForModelName(modelName: string, descriptions: string[]): Style[] {
  const korekta = overrideFor(modelName)
  if (korekta?.style !== undefined) return korekta.style
  return stylesForModel(descriptions)
}

export async function resolveStylesForProducts(
  nowe: Array<{ id: string; name: string }>,
): Promise<WynikStylu> {
  const result: WynikStylu = { models: 0, updated: 0 }
  const residential = nowe.filter((p) => categorizeDoor(p.name) === 'residential')
  if (residential.length === 0) return result

  // Modele dotknięte importem — tylko one wymagają przeliczenia.
  const dotknięte = new Set(residential.map((p) => modelOf(p.name)))

  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // Jeden odczyt kolekcji: Chroma nie filtruje po prefiksie nazwy, więc rodzeństwo
  // modelu (istniejące warianty) da się zebrać tylko skanem.
  const byModel = new Map<string, Array<{ id: string; meta: Record<string, unknown> }>>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: BATCH, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const meta = (r.metadatas[i] ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!dotknięte.has(model)) return
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push({ id, meta })
    })
    offset += r.ids.length
    if (r.ids.length < BATCH) break
  }

  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  for (const [model, warianty] of byModel) {
    result.models++
    const flags = styleFlags(
      stylesForModelName(
        model,
        warianty.map((w) => String(w.meta.description ?? '')),
      ),
    )
    for (const w of warianty) {
      if (!Object.entries(flags).some(([k, v]) => w.meta[k] !== v)) continue
      ids.push(w.id)
      metas.push({ ...w.meta, ...flags })
    }
  }

  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
  }
  result.updated = ids.length

  // Katalog się zmienił — liczniki chipów muszą przeliczyć się od nowa.
  invalidateStyleIndex()
  return result
}
