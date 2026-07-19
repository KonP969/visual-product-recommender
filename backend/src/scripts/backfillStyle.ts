// Nadaje flagi style_* wszystkim residential z ich OPISU (już w metadanych).
// Metadane-only: bez embeddingu, bez Gemini, bez wizji — jeden przelot.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/backfillStyle.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { classifyStyles, styleFlags } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  const byStyle: Record<string, number> = {}
  let scanned = 0
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = (r.metadatas[i] ?? {}) as Record<string, unknown>
      scanned++
      if (categorizeDoor(String(m.name ?? '')) !== 'residential') return
      const styles = classifyStyles(String(m.description ?? ''))
      const flags = styleFlags(styles)
      ids.push(id)
      metas.push({ ...m, ...flags })
      const key = styles.length ? styles.join('+') : '(none)'
      byStyle[key] = (byStyle[key] ?? 0) + 1
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[STYLE] Przeskanowano ${scanned}, do aktualizacji ${ids.length}`)
  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
    console.log(`[STYLE] zaktualizowano ${Math.min(i + 200, ids.length)}/${ids.length}`)
  }
  // Raport: rozkład kombinacji stylów
  console.log('[STYLE] Rozkład (kombinacja → liczba):')
  for (const [k, n] of Object.entries(byStyle).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`)
  }
  console.log('[STYLE] GOTOWE.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
