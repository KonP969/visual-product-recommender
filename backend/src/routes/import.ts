import { Router } from 'express'
import path from 'path'
import { parseStringPromise } from 'xml2js'
import axios from 'axios'
import { runImport } from '../services/importService'

export const importRouter = Router()

importRouter.post('/import', async (req, res, next) => {
  try {
    const { feedUrl, feedPath, limit } = req.body as {
      feedUrl?: string
      feedPath?: string
      limit?: number
    }

    const source = feedUrl ?? (feedPath ? path.resolve(feedPath) : null)

    if (!source) {
      res.status(400).json({ error: 'feedUrl or feedPath is required' })
      return
    }

    const parsedLimit = limit ? Math.max(1, Math.floor(Number(limit))) : undefined

    res.json({
      message: 'Import started',
      source,
      limit: parsedLimit ?? 'all',
    })

    runImport(source, { limit: parsedLimit }).catch((err: Error) => {
      console.error('[IMPORT ERROR]', err.stack)
    })
  } catch (err) {
    next(err)
  }
})

// Endpoint diagnostyczny — pokazuje surową strukturę XML bez importowania
importRouter.post('/import/preview', async (req, res, next) => {
  try {
    const { feedUrl } = req.body as { feedUrl?: string }

    if (!feedUrl) {
      res.status(400).json({ error: 'feedUrl is required' })
      return
    }

    const response = await axios.get<string>(feedUrl, {
      responseType: 'text',
      timeout: 30_000,
      headers: { 'User-Agent': 'VisualProductRecommender/1.0' },
    })

    const parsed = await parseStringPromise(response.data, { explicitArray: false })

    // Zwracamy top-level klucze i klucze pierwszego itemu
    const topKeys = Object.keys(parsed)
    const rssChannel = (parsed?.rss as Record<string, unknown>)?.channel as Record<string, unknown> | undefined
    const feed = parsed?.feed as Record<string, unknown> | undefined
    const channel = rssChannel ?? feed

    const channelKeys = channel ? Object.keys(channel) : []
    const items = (channel?.item ?? channel?.entry ?? []) as unknown[]
    const firstItem = Array.isArray(items) ? items[0] : items

    res.json({
      topLevelKeys: topKeys,
      channelKeys,
      firstItemKeys: firstItem ? Object.keys(firstItem as object) : [],
      firstItem,
      totalItems: Array.isArray(items) ? items.length : (firstItem ? 1 : 0),
    })
  } catch (err) {
    next(err)
  }
})
