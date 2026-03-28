import { Router } from 'express'
import path from 'path'
import { runImport } from '../services/importService'

export const importRouter = Router()

importRouter.post('/import', async (req, res, next) => {
  try {
    const { feedPath } = req.body as { feedPath?: string }

    if (!feedPath) {
      res.status(400).json({ error: 'feedPath is required' })
      return
    }

    const absolutePath = path.resolve(feedPath)
    res.json({ message: 'Import started', path: absolutePath })

    runImport(absolutePath).catch((err: Error) => {
      console.error('[IMPORT ERROR]', err.stack)
    })
  } catch (err) {
    next(err)
  }
})
