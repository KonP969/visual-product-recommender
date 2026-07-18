// Pełna synchronizacja katalogu z feedem:
//   1. usuwa produkty wycofane z oferty (są w bazie, brak w feedzie)
//   2. aktualizuje metadane wspólnych (cena, URL-e) bez re-embeddingu
//   3. NOWE produkty indeksuje w przestrzeni tekstowej: Gemini opis EN
//      (batch 50) → sidecar /embed-text → upsert z atrybutami
// Odporny na przerwanie: krok 3 jest naturalnie wznawialny (nowe = feed - baza).
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/syncCatalog.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { parseFeedStreaming, FeedProduct } from '../services/feedParser'
import { describeProductsBatch } from '../services/geminiService'
import { getTextEmbedding } from '../services/clipService'
import { classifyDoor } from '../services/attributeService'
import { categorizeDoor, isDoorProduct } from '../services/chromaService'
import { resolveGlassForProducts } from '../services/glassResolver'

const FEED_URL = process.env.FEED_URL ?? 'https://www.porta.com.pl/product-feed.xml'
const BATCH = 50

async function main() {
  console.log(`[SYNC] Feed: ${FEED_URL}`)
  const { products: parsed } = await parseFeedStreaming(FEED_URL, {
    onProgress: (n) => {
      if (n % 2000 === 0) console.log(`[SYNC] parsowanie: ${n}`)
    },
  })
  // Odsiew klamek, wizjerów i ościeżnic. Skutek uboczny jest zamierzony:
  // skoro nie trafiają do feedById, krok 1 usunie z bazy te zaimportowane
  // wcześniej — czyszczenie katalogu jedzie tą samą ścieżką co wycofania.
  const products = parsed.filter((p) => isDoorProduct(p.categoryMain))
  const dropped = parsed.length - products.length
  console.log(`[SYNC] Feed: ${products.length} drzwi (odsiano ${dropped} nie-drzwi z ${parsed.length})`)
  const feedById = new Map(products.map((p) => [p.id, p]))

  const client = new ChromaClient({ path: 'http://localhost:8000' })
  const col = await client.getCollection({ name: 'products' })

  // --- inwentaryzacja bazy
  const dbMeta = new Map<string, Record<string, unknown>>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => dbMeta.set(id, r.metadatas[i] as any))
    offset += r.ids.length
    if (r.ids.length < 500) break
  }
  console.log(`[SYNC] Baza: ${dbMeta.size} produktów`)

  // --- 1. wycofane
  const staleIds = [...dbMeta.keys()].filter((id) => !feedById.has(id))
  for (let i = 0; i < staleIds.length; i += 500) {
    await col.delete({ ids: staleIds.slice(i, i + 500) })
  }
  console.log(`[SYNC] Usunięto wycofanych: ${staleIds.length}`)

  // --- 2. aktualizacja wspólnych (cena / URL-e mogły się zmienić)
  const commonIds: string[] = []
  const commonMetas: Record<string, unknown>[] = []
  for (const [id, meta] of dbMeta) {
    const feed = feedById.get(id)
    if (!feed) continue
    if (
      meta.price !== feed.price ||
      meta.productUrl !== feed.productUrl ||
      meta.imageUrl !== feed.imageUrl
    ) {
      commonIds.push(id)
      commonMetas.push({
        ...meta,
        price: feed.price,
        productUrl: feed.productUrl,
        imageUrl: feed.imageUrl,
      })
    }
  }
  for (let i = 0; i < commonIds.length; i += 200) {
    await col.update({ ids: commonIds.slice(i, i + 200), metadatas: commonMetas.slice(i, i + 200) as any })
  }
  console.log(`[SYNC] Zaktualizowano metadane: ${commonIds.length}`)

  // --- 3. nowe produkty → opis Gemini → embedding tekstowy → upsert
  const newProducts: FeedProduct[] = products.filter((p) => !dbMeta.has(p.id))
  console.log(`[SYNC] Nowych do zaindeksowania: ${newProducts.length}`)

  let indexed = 0
  let failed = 0
  const dodane: { id: string; name: string; imageUrl: string }[] = []
  for (let b = 0; b < newProducts.length; b += BATCH) {
    const batch = newProducts.slice(b, b + BATCH)
    try {
      const descriptions = await describeProductsBatch(
        batch.map((p, i) => ({ i: i + 1, name: p.name })),
      )
      const ids: string[] = []
      const embeddings: number[][] = []
      const metadatas: Record<string, unknown>[] = []
      for (let i = 0; i < batch.length; i++) {
        const p = batch[i]
        const desc = descriptions[i + 1]
        if (!desc) {
          failed++
          continue
        }
        const embedding = await getTextEmbedding(desc)
        const attrs = classifyDoor(p.name, desc)
        ids.push(p.id)
        dodane.push({ id: p.id, name: p.name, imageUrl: p.imageUrl })
        embeddings.push(embedding)
        metadatas.push({
          name: p.name,
          price: p.price,
          imageUrl: p.imageUrl,
          productUrl: p.productUrl,
          description: desc,
          category: categorizeDoor(p.name),
          currency: 'PLN',
          color_family: attrs.colorFamily,
          has_glass: attrs.hasGlass,
          lightness: attrs.lightness,
        })
      }
      if (ids.length > 0) {
        await col.upsert({ ids, embeddings, metadatas: metadatas as any })
        indexed += ids.length
      }
      console.log(`[SYNC] batch ${Math.floor(b / BATCH) + 1}/${Math.ceil(newProducts.length / BATCH)}: +${ids.length} (razem ${indexed})`)
    } catch (err) {
      failed += batch.length
      console.warn(`[SYNC] batch ${Math.floor(b / BATCH) + 1} padł:`, err instanceof Error ? err.message.slice(0, 120) : err)
    }
  }

  if (dodane.length > 0) {
    console.log(`[SYNC] Wizyjne szkło dla ${dodane.length} nowych…`)
    const glass = await resolveGlassForProducts(dodane)
    console.log(`[SYNC] Szkło: ${glass.flips} korekt, ${glass.visionCalls} wizji, ${glass.failed} nierozstrzygniętych`)
  }

  const finalCount = await col.count()
  console.log(`[SYNC] GOTOWE. Usunięte: ${staleIds.length} | zaktualizowane: ${commonIds.length} | nowe: ${indexed} | nieudane: ${failed}`)
  console.log(`[SYNC] Baza po synchronizacji: ${finalCount} produktów`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
