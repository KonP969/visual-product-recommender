import { parseFeedStreaming } from './feedParser'
import { downloadImage } from './imageDownloader'
import { getEmbedding } from './clipService'
import { upsertProduct, productExists, categorizeDoor } from './chromaService'
import { classifyDoor } from './attributeService'

export interface ImportProgress {
  current: number
  total: number      // products being imported (after limit applied)
  feedTotal: number | null  // all products in XML — null when stopped early
  success: number
  skipped: number
  failed: number
}

export interface ImportOptions {
  limit?: number
  /** Co ~100 znalezionych podczas parsowania XML */
  onParseProgress?: (found: number) => void
  /** Po zakończeniu parsowania, przed startem pętli importu */
  onParsed?: (feedTotal: number | null, importCount: number) => void
  onProgress?: (p: ImportProgress) => void
}

export async function runImport(source: string, options: ImportOptions = {}): Promise<ImportProgress> {
  console.log(`[IMPORT] Streaming parse: ${source}`)

  const { products, stoppedEarly } = await parseFeedStreaming(source, {
    limit: options.limit,
    onProgress: options.onParseProgress,
  })

  const feedTotal = stoppedEarly ? null : products.length

  console.log(
    `[IMPORT] Parsed ${products.length} products` +
    (stoppedEarly ? ' (stopped at limit)' : ` (feed total: ${products.length})`),
  )

  options.onParsed?.(feedTotal, products.length)

  let success = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    const label = `[${i + 1}/${products.length}]`

    try {
      const exists = await productExists(product.id)
      if (exists) {
        skipped++
        console.log(`[IMPORT] ${label} SKIP ${product.name}`)
      } else {
        const { buffer, mimetype } = await downloadImage(product.imageUrl)
        const embedding = await getEmbedding(buffer, mimetype)
        const attrs = classifyDoor(product.name)
        await upsertProduct(product.id, embedding, {
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          productUrl: product.productUrl,
          category: categorizeDoor(product.name),
          currency: 'PLN',
          color_family: attrs.colorFamily,
          has_glass: attrs.hasGlass,
          lightness: attrs.lightness,
        })
        success++
        console.log(`[IMPORT] ${label} ✓ ${product.name}`)
      }
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[IMPORT] ${label} ✗ ${product.name} — ${message}`)
    }

    options.onProgress?.({
      current: i + 1,
      total: products.length,
      feedTotal,
      success,
      skipped,
      failed,
    })
  }

  const result: ImportProgress = {
    current: products.length,
    total: products.length,
    feedTotal,
    success,
    skipped,
    failed,
  }

  console.log(
    `[IMPORT] Done. Total: ${products.length} | New: ${success} | Skipped: ${skipped} | Failed: ${failed}`,
  )

  return result
}
