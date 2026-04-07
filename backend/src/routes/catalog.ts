import { Router } from 'express'
import { getProductCount, listProducts } from '../services/chromaService'

export const catalogRouter = Router()

catalogRouter.get('/catalog/stats', async (_req, res, next) => {
  try {
    const count = await getProductCount()
    res.json({ count })
  } catch (err) {
    next(err)
  }
})

catalogRouter.get('/catalog/list', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100)
    const offset = Number(req.query.offset ?? 0)
    const [products, total] = await Promise.all([
      listProducts(limit, offset),
      getProductCount(),
    ])
    res.json({ products, total, limit, offset })
  } catch (err) {
    next(err)
  }
})
