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

function str(val: unknown): string | undefined {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && '_' in val) return (val as { _: string })._
  return undefined
}

function extractProducts(parsed: Record<string, unknown>): FeedProduct[] {
  // Format: <offers><o>...</o></offers>  (Ceneo / custom)
  const offersRoot = parsed?.offers as Record<string, unknown> | undefined
  if (offersRoot) {
    const rawItems = offersRoot.o ?? []
    const items = Array.isArray(rawItems) ? rawItems : [rawItems]
    return (items as Record<string, unknown>[])
      .map((item, idx): FeedProduct | null => {
        const name = str(item.name)
        const imageUrl = str(item.url_img)
        if (!name || !imageUrl) return null
        return {
          id: str(item.external_id) ?? String(idx),
          name,
          imageUrl,
          price: str(item.price) ?? '—',
          productUrl: str(item.url_product),
        }
      })
      .filter((p): p is FeedProduct => p !== null)
  }

  // Format: <rss><channel><item>...</item></channel></rss>  (Google Merchant)
  const rssChannel = (parsed?.rss as Record<string, unknown>)?.channel as Record<string, unknown> | undefined
  // Format: <feed><entry>...</entry></feed>  (Atom)
  const atomFeed = parsed?.feed as Record<string, unknown> | undefined
  const channel = rssChannel ?? atomFeed

  if (channel) {
    const rawItems = channel.item ?? channel.entry ?? []
    const items = Array.isArray(rawItems) ? rawItems : [rawItems]
    return (items as Record<string, unknown>[])
      .map((item, idx): FeedProduct | null => {
        const name = str(item['g:title']) ?? str(item.title)
        const imageUrl = str(item['g:image_link']) ?? str(item.image_link)
        if (!name || !imageUrl) return null
        return {
          id: str(item['g:id']) ?? str(item.id) ?? String(idx),
          name,
          imageUrl,
          price: str(item['g:price']) ?? str(item.price) ?? '—',
          productUrl: str(item['g:link']) ?? str(item.link),
        }
      })
      .filter((p): p is FeedProduct => p !== null)
  }

  return []
}

export async function parseFeed(source: string): Promise<FeedProduct[]> {
  const xml = await fetchXml(source)
  const parsed = await parseStringPromise(xml, { explicitArray: false })
  return extractProducts(parsed as Record<string, unknown>)
}
