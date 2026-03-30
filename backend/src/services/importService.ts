import { parseFeed } from './feedParser'
import { downloadImage } from './imageDownloader'
import { getEmbedding } from './clipService'
import { upsertProduct } from './chromaService'

export interface ImportOptions {
  limit?: number
}

export async function runImport(source: string, options: ImportOptions = {}): Promise<void> {
  console.log(`[IMPORT] Parsing feed: ${source}`)
  const allProducts = await parseFeed(source)

  const products = options.limit
    ? allProducts.slice(0, options.limit)
    : allProducts

  console.log(
    `[IMPORT] Found ${allProducts.length} products, importing ${products.length}`,
  )

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
