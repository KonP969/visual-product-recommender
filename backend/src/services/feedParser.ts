import sax from 'sax'
import { createReadStream } from 'fs'
import axios from 'axios'

export interface FeedProduct {
  id: string
  name: string
  imageUrl: string
  price: string
  productUrl?: string
}

export interface StreamParseOptions {
  limit?: number
  /** Wywoływane co ~100 znalezionych produktów podczas parsowania */
  onProgress?: (found: number) => void
}

type FeedFormat = 'ceneo' | 'rss' | 'atom'

function buildProduct(
  data: Record<string, string>,
  format: FeedFormat,
  fallbackId: string,
): FeedProduct | null {
  if (format === 'ceneo') {
    const name = data['name']
    const imageUrl = data['url_img']
    if (!name || !imageUrl) return null
    return {
      id: data['external_id'] ?? fallbackId,
      name,
      imageUrl,
      price: data['price'] ?? '—',
      productUrl: data['url_product'],
    }
  }

  // rss (Google Merchant) or atom
  const name = data['g:title'] ?? data['title']
  const imageUrl = data['g:image_link'] ?? data['image_link']
  if (!name || !imageUrl) return null
  return {
    id: data['g:id'] ?? data['id'] ?? fallbackId,
    name,
    imageUrl,
    price: data['g:price'] ?? data['price'] ?? '—',
    productUrl: data['g:link'] ?? data['link'],
  }
}

/**
 * Strumieniowy parser XML feedu.
 * Zatrzymuje pobieranie po znalezieniu `limit` produktów (wczesne wyjście).
 * Zwraca { products, stoppedEarly } — gdy stoppedEarly=true, feedTotal jest nieznany.
 */
export function parseFeedStreaming(
  source: string,
  options: StreamParseOptions = {},
): Promise<{ products: FeedProduct[]; stoppedEarly: boolean }> {
  const { limit, onProgress } = options

  return new Promise((resolve, reject) => {
    const products: FeedProduct[] = []
    let stoppedEarly = false
    let resolved = false
    let destroyStream: (() => void) | null = null

    let format: FeedFormat | null = null
    let inOffers = false   // dla formatu Ceneo
    let inProduct = false
    let currentData: Record<string, string> = {}
    let textBuf = ''

    const finish = () => {
      if (resolved) return
      resolved = true
      destroyStream?.()
      resolve({ products, stoppedEarly })
    }

    // lowercase:true → tagi małymi literami, ale g:title pozostaje g:title
    const saxStream = sax.createStream(false, { lowercase: true, trim: false })

    saxStream.on('opentag', (node) => {
      const name = (node as sax.Tag).name

      // Wykrywanie formatu
      if (!format) {
        if (name === 'offers') format = 'ceneo'
        else if (name === 'rss') format = 'rss'
        else if (name === 'feed') format = 'atom'
      }

      if (format === 'ceneo' && name === 'offers') inOffers = true

      const isProductTag =
        (format === 'ceneo' && name === 'o' && inOffers) ||
        (format === 'rss' && name === 'item') ||
        (format === 'atom' && name === 'entry')

      if (isProductTag && !inProduct) {
        inProduct = true
        currentData = {}
        // Ceneo: external_id bywa atrybutem <o id="123">
        const attrs = (node as sax.Tag).attributes as Record<string, string>
        if (attrs['id']) currentData['external_id'] = attrs['id']
      }

      textBuf = ''
    })

    saxStream.on('text', (text) => {
      if (inProduct) textBuf += text
    })

    saxStream.on('cdata', (cdata) => {
      if (inProduct) textBuf += cdata
    })

    saxStream.on('closetag', (name) => {
      const isProductTag =
        (format === 'ceneo' && name === 'o') ||
        (format === 'rss' && name === 'item') ||
        (format === 'atom' && name === 'entry')

      if (format === 'ceneo' && name === 'offers') inOffers = false

      if (inProduct) {
        if (!isProductTag && textBuf.trim()) {
          // Zapisz wartość pola (np. <name>, <g:title>, …)
          currentData[name] = textBuf.trim()
        }

        if (isProductTag) {
          inProduct = false
          const product = buildProduct(currentData, format!, String(products.length))
          if (product) {
            products.push(product)
            // Odpala przy pierwszym produkcie, potem co 10% limitu (min co 1, max co 100)
            const every = limit ? Math.max(1, Math.floor(limit / 10)) : 100
            if (products.length === 1 || products.length % every === 0) {
              onProgress?.(products.length)
            }
            if (limit && products.length >= limit) {
              stoppedEarly = true
              finish()
              return
            }
          }
          currentData = {}
        }
      }

      textBuf = ''
    })

    saxStream.on('error', () => {
      // Ignoruj błędy parsowania (np. encje HTML) i kontynuuj
      ;(saxStream as unknown as { _parser: { error: null; resume: () => void } })._parser.error = null
      ;(saxStream as unknown as { _parser: { resume: () => void } })._parser.resume()
    })

    saxStream.on('end', finish)

    // Uruchom strumień
    if (source.startsWith('http://') || source.startsWith('https://')) {
      axios
        .get<import('stream').Readable>(source, {
          responseType: 'stream',
          timeout: 120_000,
          headers: {
            'User-Agent': 'VisualProductRecommender/1.0',
            'Accept-Encoding': 'identity', // wyłącz gzip — SAX potrzebuje czystego XML
          },
          decompress: false,
        })
        .then((response) => {
          destroyStream = () => {
            try { response.data.destroy() } catch { /* ignore */ }
          }
          response.data.on('error', reject)
          response.data.pipe(saxStream)
        })
        .catch(reject)
    } else {
      const fileStream = createReadStream(source)
      destroyStream = () => {
        try { fileStream.destroy() } catch { /* ignore */ }
      }
      fileStream.on('error', reject)
      fileStream.pipe(saxStream)
    }
  })
}
