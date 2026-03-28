import { parseStringPromise } from 'xml2js'
import { readFile } from 'fs/promises'

export interface FeedProduct {
  id: string
  name: string
  imageUrl: string
  price: string
  productUrl?: string
}

export async function parseFeed(filePath: string): Promise<FeedProduct[]> {
  const xml = await readFile(filePath, 'utf-8')
  const parsed = await parseStringPromise(xml, { explicitArray: false })

  // Obsługa formatu Google Merchant / Ceneo
  const channel = parsed?.rss?.channel ?? parsed?.feed
  const rawItems: Record<string, unknown>[] = channel?.item ?? channel?.entry ?? []

  const items = Array.isArray(rawItems) ? rawItems : [rawItems]

  return items
    .map((item, idx): FeedProduct | null => {
      const name =
        (item['g:title'] as string) ??
        (item['title'] as string) ??
        null

      const imageUrl =
        (item['g:image_link'] as string) ??
        (item['image_link'] as string) ??
        null

      const price =
        (item['g:price'] as string) ??
        (item['price'] as string) ??
        '—'

      const productUrl =
        (item['g:link'] as string) ??
        (item['link'] as string) ??
        undefined

      const id =
        (item['g:id'] as string) ??
        (item['id'] as string) ??
        String(idx)

      if (!name || !imageUrl) return null

      return { id, name, imageUrl, price, productUrl }
    })
    .filter((p): p is FeedProduct => p !== null)
}
