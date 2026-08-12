import { parseFeedStreaming } from './feedParser'
import { downloadImage } from './imageDownloader'
import { getEmbedding } from './clipService'
import { upsertProduct, productExists, categorizeDoor, isDoorProduct } from './chromaService'
import { classifyDoor, styleFlags } from './attributeService'
import { resolveGlassForProducts } from './glassResolver'
import { resolveStylesForProducts } from './styleResolver'

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

  const { products: parsed, stoppedEarly } = await parseFeedStreaming(source, {
    limit: options.limit,
    onProgress: options.onParseProgress,
  })

  // Feed miesza z drzwiami klamki, wizjery i ościeżnice. Bez tego odsiewu
  // wchodzą do katalogu jako drzwi (categorizeDoor to denylista) i wypływają
  // w wynikach wyszukiwania.
  const products = parsed.filter((p) => isDoorProduct(p.categoryMain))
  const dropped = parsed.length - products.length

  const feedTotal = stoppedEarly ? null : products.length

  console.log(
    `[IMPORT] Parsed ${parsed.length} products` +
    (stoppedEarly ? ' (stopped at limit)' : ` (feed total: ${parsed.length})`) +
    (dropped > 0 ? ` — odsiano ${dropped} nie-drzwi z feedu` : ''),
  )

  options.onParsed?.(feedTotal, products.length)

  let success = 0
  let skipped = 0
  let failed = 0
  const dodane: { id: string; name: string; imageUrl: string }[] = []

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
        // Import z UI woła classifyDoor bez opisu (ścieżka jest obrazowa,
        // opis nie istnieje na tym etapie) → attrs.styles zawsze [] →
        // style_none: true. Zamierzone: takie drzwi filtr stylu nigdy nie
        // odcina (zabezpieczenie), więc zawsze są pokazywane.
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
          ...styleFlags(attrs.styles),
        })
        success++
        dodane.push({ id: product.id, name: product.name, imageUrl: product.imageUrl })
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

  if (dodane.length > 0) {
    console.log(`[IMPORT] Wizyjne szkło dla ${dodane.length} nowych…`)
    try {
      const glass = await resolveGlassForProducts(dodane)
      console.log(`[IMPORT] Szkło: ${glass.flips} korekt, ${glass.visionCalls} wizji, ${glass.failed} nierozstrzygniętych`)
    } catch (err) {
      console.warn('[IMPORT] Wizyjne szkło padło (pomijam):', err instanceof Error ? err.message : err)
    }

    try {
      const style = await resolveStylesForProducts(dodane)
      console.log(`[IMPORT] Styl: ${style.updated} rekordów w ${style.models} modelach`)
    } catch (err) {
      console.warn('[IMPORT] Styl per model padł (pomijam):', err instanceof Error ? err.message : err)
    }
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
