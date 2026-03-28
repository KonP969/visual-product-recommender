import { parseFeed } from './feedParser'
import { downloadImage } from './imageDownloader'
import { getEmbedding } from './clipService'
import { upsertProduct } from './chromaService'

export async function runImport(feedPath: string): Promise<void> {
  console.log(`[IMPORT] Parsing feed: ${feedPath}`)
  const products = await parseFeed(feedPath)
  console.log(`[IMPORT] Found ${products.length} products`)

  let success = 0
  let failed = 0

  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    const progress = `[${i + 1}/${products.length}]`

    try {
      const { buffer, mimetype } = await downloadImage(product.imageUrl)
      const embedding = await getEmbedding(buffer, mimetype)
      await upsertProduct(product.id, embedding, {
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
      })
      success++
      console.log(`[IMPORT] ${progress} ✓ ${product.name}`)
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[IMPORT] ${progress} ✗ ${product.name} — ${message}`)
    }
  }

  console.log(
    `[IMPORT] Done. Total: ${products.length} | Success: ${success} | Failed: ${failed}`,
  )
}
