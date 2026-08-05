// Nadaje flagi style_* wszystkim residential — jedna decyzja NA MODEL, propagowana
// na warianty kolorystyczne. Metadane-only: bez embeddingu, bez Gemini, bez wizji.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/backfillStyle.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { styleFlags } from '../services/attributeService'
import { modelOf } from '../services/glassResolver'
import { stylesForModelName } from '../services/styleResolver'
import { categorizeDoor } from '../services/chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

interface Rekord {
  id: string
  meta: Record<string, unknown>
}

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  // 1. Wczytaj cały katalog i zgrupuj residential po modelu.
  const byModel = new Map<string, Rekord[]>()
  let scanned = 0
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const meta = (r.metadatas[i] ?? {}) as Record<string, unknown>
      scanned++
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') return
      const model = modelOf(name)
      if (!byModel.has(model)) byModel.set(model, [])
      byModel.get(model)!.push({ id, meta })
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[STYLE] Przeskanowano ${scanned}, residential w ${byModel.size} modelach`)

  // 2. Głosowanie per model → identyczne flagi dla wszystkich wariantów.
  const ids: string[] = []
  const metas: Record<string, unknown>[] = []
  const byStyle: Record<string, number> = {}
  for (const [model, warianty] of byModel) {
    // Głosowanie z opisów + tabela korekt (korekta zastępuje wynik głosowania).
    // Filtrowanie pustych opisów siedzi w stylesForModel — patrz uzasadnienie tam.
    const opisy = warianty.map((w) => String(w.meta.description ?? ''))
    const style = stylesForModelName(model, opisy)
    const flags = styleFlags(style)
    const key = style.length ? style.join('+') : '(none)'
    byStyle[key] = (byStyle[key] ?? 0) + warianty.length
    for (const w of warianty) {
      // Aktualizujemy tylko rekordy, którym flagi się zmieniają — mniej zapisu.
      const różni = Object.entries(flags).some(([k, v]) => w.meta[k] !== v)
      if (!różni) continue
      ids.push(w.id)
      metas.push({ ...w.meta, ...flags })
    }
  }
  console.log(`[STYLE] Do aktualizacji ${ids.length} rekordów`)

  for (let i = 0; i < ids.length; i += 200) {
    await col.update({ ids: ids.slice(i, i + 200), metadatas: metas.slice(i, i + 200) as any })
    console.log(`[STYLE] zaktualizowano ${Math.min(i + 200, ids.length)}/${ids.length}`)
  }

  console.log('[STYLE] Rozkład (kombinacja → warianty):')
  for (const [k, n] of Object.entries(byStyle).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`)
  }
  console.log('[STYLE] GOTOWE.')
  // Ten skrypt to osobny proces — unieważnienie indeksu w pamięci NIE dosięga
  // działającego backendu, więc liczniki chipów zostaną stare aż do restartu.
  console.log(
    '[STYLE] UWAGA: zrestartuj backend (albo dotknij dowolnego pliku w backend/src — ' +
      'ts-node-dev przeładuje się sam), inaczej liczniki chipów stylu pozostaną sprzed backfillu.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
