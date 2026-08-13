// Porównuje aktualny feed z zawartością ChromaDB: ilu produktów już nie ma
// w ofercie (stale) i ile jest nowych.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/compareFeed.ts
import { ChromaClient } from 'chromadb'
import { parseFeedStreaming } from '../services/feedParser'
import { isDoorProduct } from '../services/chromaService'

const FEED_URL = process.env.FEED_URL ?? 'https://www.porta.com.pl/product-feed.xml'

async function main() {
  console.log(`Pobieram feed: ${FEED_URL}`)
  const { products: parsed } = await parseFeedStreaming(FEED_URL, {
    onProgress: (n) => process.stdout.write(`\r  sparsowano ${n}`),
  })
  const products = parsed.filter((p) => isDoorProduct(p.categoryMain))
  console.log(`\nFeed: ${products.length} produktów (drzwi; odsiano ${parsed.length - products.length} nie-drzwi)`)
  const feedIds = new Set(products.map((p) => p.id))

  const client = new ChromaClient({ path: 'http://localhost:8000' })
  const col = await client.getCollection({ name: 'products' })
  const dbIds: string[] = []
  const staleNames: string[] = []
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      dbIds.push(id)
      if (!feedIds.has(id)) staleNames.push((r.metadatas[i] as any).name)
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  const dbSet = new Set(dbIds)
  const newInFeed = products.filter((p) => !dbSet.has(p.id))

  console.log(`Baza:  ${dbIds.length} produktów`)
  console.log(`WYCOFANE (w bazie, brak w feedzie): ${staleNames.length}`)
  console.log(`NOWE (w feedzie, brak w bazie):     ${newInFeed.length}`)
  console.log('\nPrzykłady wycofanych:')
  staleNames.slice(0, 8).forEach((n) => console.log('  -', n.slice(0, 70)))
  console.log('\nPrzykłady nowych:')
  newInFeed.slice(0, 8).forEach((p) => console.log('  +', p.name.slice(0, 70)))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
