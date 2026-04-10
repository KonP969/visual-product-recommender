import { Router } from 'express'
import {
  getProductCount,
  listProducts,
  getProductEmbedding,
  searchProductsByName,
} from '../services/chromaService'

export const catalogRouter = Router()

catalogRouter.get('/catalog/stats', async (_req, res, next) => {
  try {
    const count = await getProductCount()
    res.json({ count })
  } catch (err) {
    next(err)
  }
})

catalogRouter.get('/catalog/embedding/:id', async (req, res, next) => {
  try {
    const result = await getProductEmbedding(req.params.id)
    if (!result) {
      res.status(404).json({ error: 'Product not found' })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

catalogRouter.get('/catalog/list', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100)
    const offset = Number(req.query.offset ?? 0)
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    if (q) {
      const { products, total } = await searchProductsByName(q, limit, offset)
      res.json({ products, total, limit, offset })
    } else {
      const [products, total] = await Promise.all([
        listProducts(limit, offset),
        getProductCount(),
      ])
      res.json({ products, total, limit, offset })
    }
  } catch (err) {
    next(err)
  }
})
