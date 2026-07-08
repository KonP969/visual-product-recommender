// Backfill color_family / has_glass / lightness na wszystkich produktach.
// Uruchomienie:  cd backend && npx ts-node src/scripts/backfillAttributes.ts
import { ChromaClient } from 'chromadb'
import { classifyDoor } from '../services/attributeService'

const client = new ChromaClient({ path: process.env.CHROMA_URL ?? 'http://localhost:8000' })

async function main() {
  const col = await client.getCollection({ name: 'products' })
  const total = await col.count()
  console.log(`Products: ${total}`)

  const BATCH = 200
  let offset = 0
  let updated = 0
  const familyCounts: Record<string, number> = {}
  let glassCount = 0

  while (true) {
    const r = await col.get({ limit: BATCH, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break

    const metadatas = r.metadatas.map((meta: any) => {
      const attrs = classifyDoor(meta.name ?? '', meta.description ?? '')
      familyCounts[attrs.colorFamily] = (familyCounts[attrs.colorFamily] ?? 0) + 1
      if (attrs.hasGlass) glassCount++
      return {
        ...meta,
        color_family: attrs.colorFamily,
        has_glass: attrs.hasGlass,
        lightness: attrs.lightness,
      }
    })

    await col.update({ ids: r.ids, metadatas })
    updated += r.ids.length
    offset += r.ids.length
    process.stdout.write(`\r  updated ${updated}/${total}`)
    if (r.ids.length < BATCH) break
  }

  console.log(`\nDone. has_glass=true: ${glassCount}`)
  console.log('color_family distribution:')
  for (const [family, count] of Object.entries(familyCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${family}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
