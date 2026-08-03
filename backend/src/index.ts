import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/errorHandler'
import { healthRouter } from './routes/health'
import { catalogRouter } from './routes/catalog'
import { searchRouter } from './routes/search'
import { importRouter } from './routes/import'
import { warmStyleIndex } from './services/styleIndex'

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json())

app.use('/api', healthRouter)
app.use('/api', catalogRouter)
app.use('/api', searchRouter)
app.use('/api', importRouter)

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  // Indeks liczników chipów buduje się ~3,3 s. Rozgrzewamy go w tle, żeby ten
  // koszt nie doliczył się do pierwszego wyszukiwania — i nie blokujemy startu,
  // bo ChromaDB może jeszcze wstawać (wtedy zbuduje się przy pierwszym żądaniu).
  warmStyleIndex().catch((err) => {
    console.warn('[STYLE-INDEX] Rozgrzewka nieudana:', err instanceof Error ? err.message : err)
  })
})
