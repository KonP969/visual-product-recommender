import { Router } from 'express'
import path from 'path'
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
