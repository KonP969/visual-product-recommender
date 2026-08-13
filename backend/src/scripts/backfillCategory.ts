// Przelicza `category` (residential/specialty) na żywo z NAZWY dla wszystkich
// rekordów już w bazie i aktualizuje te, którym się zmieniła.
//
// Powód: `category` jest zapisywana raz przy imporcie (categorizeDoor(name)),
// więc rozszerzenie COMMERCIAL_DOOR_PATTERNS w chromaService.ts (np. o nowy
// wzorzec drzwi specjalistycznych) nie ma wpływu na już zaimportowane
// rekordy, dopóki się ich nie przeliczy — `buildWhere()` filtruje wyszukiwanie
// obrazem po ZAPISANYM `category`, nie po żywym categorizeDoor(name).
//
// Bezpieczny i idempotentny: aktualizuje tylko rekordy, którym categorizeDoor
// dałby inny wynik niż to, co jest zapisane.
//
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/backfillCategory.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { categorizeDoor } from '../services/chromaService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  const updIds: string[] = []
  const updMetas: Record<string, unknown>[] = []
  const flipped: string[] = []
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = r.metadatas[i] as any
      const current = m.category ?? 'residential'
      const recomputed = categorizeDoor(m.name ?? '')
      if (current !== recomputed) {
        updIds.push(id)
        updMetas.push({ ...m, category: recomputed })
        flipped.push(m.name)
      }
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  console.log(`[BACKFILL-CATEGORY] Rekordów do zmiany: ${updIds.length}`)
  flipped.slice(0, 10).forEach((n) => console.log(`  - ${n}`))
  if (flipped.length > 10) console.log(`  ... i ${flipped.length - 10} więcej`)

  for (let i = 0; i < updIds.length; i += 200) {
    await col.update({ ids: updIds.slice(i, i + 200), metadatas: updMetas.slice(i, i + 200) as any })
  }

  console.log('[BACKFILL-CATEGORY] GOTOWE.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
