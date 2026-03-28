import { Router } from 'express'
import { isSidecarHealthy } from '../services/clipService'
import { isChromaHealthy } from '../services/chromaService'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res, next) => {
  try {
    const [chroma, sidecar] = await Promise.all([
      isChromaHealthy(),
      isSidecarHealthy(),
    ])

    const allHealthy = chroma && sidecar
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'ok' : 'degraded',
      services: {
        backend: true,
        chromadb: chroma,
        clip_sidecar: sidecar,
      },
    })
  } catch (err) {
    next(err)
  }
})
