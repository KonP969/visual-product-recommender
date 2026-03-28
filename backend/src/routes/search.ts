import { Router } from 'express'
import multer from 'multer'
import { getEmbedding } from '../services/clipService'
import { searchSimilar } from '../services/chromaService'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type'))
    }
  },
})

export const searchRouter = Router()

searchRouter.post('/search', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image provided' })
      return
    }

    const embedding = await getEmbedding(req.file.buffer, req.file.mimetype)
    const { results, isLowSimilarity } = await searchSimilar(embedding, 10)

    if (results.length === 0) {
      res.json({ products: [], status: 'empty-catalog' })
      return
    }

    const products = results.map((r) => ({
      id: r.id,
      name: r.metadata.name,
      price: r.metadata.price,
      imageUrl: r.metadata.imageUrl,
      productUrl: r.metadata.productUrl,
      similarity: r.similarity,
    }))

    res.json({
      products,
      status: isLowSimilarity ? 'low-similarity' : 'success',
    })
  } catch (err) {
    next(err)
  }
})
