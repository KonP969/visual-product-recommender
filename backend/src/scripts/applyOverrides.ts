// Nakłada docs/style-overrides.json na ISTNIEJĄCY katalog: styl i has_glass.
// Metadane-only, bez wizji, bez Gemini, bez embeddingów. Idempotentny —
// drugie uruchomienie nie zmienia niczego.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/applyOverrides.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { styleFlags } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'
import { modelOf, glassForModelName } from '../services/glassResolver'
import { stylesForModelName } from '../services/styleResolver'
import { overrideFor } from '../services/overrides'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  const byModel = new Map<string, Array<{ id: string; meta: Record<string, unknown> }>>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const meta = (r.metadatas[i] ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push({ id, meta })
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[OVERRIDES] Residential w ${byModel.size} modelach`)

  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  let modeliZeStylem = 0
  let modeliZeSzklem = 0

  for (const [model, warianty] of byModel) {
    const korekta = overrideFor(model)
    if (!korekta) continue

    const zmiany: Record<string, unknown> = {}
    if (korekta.style !== undefined) {
      // stylesForModelName zwróci korektę; opisy podajemy dla porządku
      Object.assign(
        zmiany,
        styleFlags(
          stylesForModelName(
            model,
            warianty.map((w) => String(w.meta.description ?? '')),
          ),
        ),
      )
      modeliZeStylem++
    }
    if (korekta.hasGlass !== undefined) {
      zmiany.has_glass = glassForModelName(model, null)
      modeliZeSzklem++
    }

    for (const w of warianty) {
      const różni = Object.entries(zmiany).some(([k, v]) => w.meta[k] !== v)
      if (!różni) continue
      ids.push(w.id)
      metas.push({ ...w.meta, ...zmiany })
    }
  }

  console.log(
    `[OVERRIDES] Korekty dotyczą ${modeliZeStylem} modeli (styl) i ${modeliZeSzklem} (szkło); rekordów do zmiany: ${ids.length}`,
  )
  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
    console.log(`[OVERRIDES] zaktualizowano ${Math.min(i + 200, ids.length)}/${ids.length}`)
  }
  console.log('[OVERRIDES] GOTOWE.')
  console.log(
    '[OVERRIDES] UWAGA: zrestartuj backend (albo dotknij pliku w backend/src — ts-node-dev ' +
      'przeładuje się sam), inaczej liczniki chipów stylu pozostaną sprzed korekt.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
