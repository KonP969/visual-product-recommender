import { parseStringPromise } from 'xml2js'
import { readFile } from 'fs/promises'
import axios from 'axios'

export interface FeedProduct {
  id: string
  name: string
  imageUrl: string
  price: string
  productUrl?: string
}

async function fetchXml(source: string): Promise<string> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await axios.get<string>(source, {
      responseType: 'text',
      timeout: 30_000,
      headers: { 'User-Agent': 'VisualProductRecommender/1.0' },
    })
    return response.data
  }
  return readFile(source, 'utf-8')
}

function extractProducts(parsed: Record<string, unknown>): FeedProduct[] {
  const channel =
    (parsed?.rss as Record<string, unknown>)?.channel ??
    (parsed?.feed as Record<string, unknown>)

  const rawItems = (channel as Record<string, unknown>)?.item ??
    (channel as Record<string, unknown>)?.entry ?? []

  const items = Array.isArray(rawItems) ? rawItems : [rawItems]

  return (items as Record<string, unknown>[])
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

export async function parseFeed(source: string): Promise<FeedProduct[]> {
  const xml = await fetchXml(source)
  const parsed = await parseStringPromise(xml, { explicitArray: false })
  return extractProducts(parsed as Record<string, unknown>)
}
