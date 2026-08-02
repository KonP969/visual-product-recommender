// Kontrola po backfillu: czy WSZYSTKIE warianty modelu mają identyczne flagi stylu.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/checkStyleConsistency.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { STYLES } from '../services/attributeService'
import { modelOf } from '../services/glassResolver'
import { categorizeDoor } from '../services/chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })
  const byModel = new Map<string, Record<string, unknown>[]>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.metadatas.forEach((m: any) => {
      const meta = (m ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push(meta)
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  const klucze = [...STYLES.map((s) => 'style_' + s), 'style_none']
  let niespójne = 0
  const licznik: Record<string, number> = {}
  for (const [model, warianty] of byModel) {
    const wzorzec = klucze.map((k) => warianty[0][k]).join(',')
    if (warianty.some((w) => klucze.map((k) => w[k]).join(',') !== wzorzec)) {
      niespójne++
      console.log(`  NIESPÓJNY: ${model}`)
    }
    for (const s of STYLES) {
      if (warianty[0]['style_' + s] === true) licznik[s] = (licznik[s] ?? 0) + warianty.length
    }
    if (warianty[0].style_none === true) licznik['(none)'] = (licznik['(none)'] ?? 0) + warianty.length
  }
  console.log(`\nmodeli: ${byModel.size} | niespójnych: ${niespójne}`)
  console.log('warianty per styl:', JSON.stringify(licznik))
  if (niespójne > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
