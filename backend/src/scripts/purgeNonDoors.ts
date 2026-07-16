// Usuwa z katalogu oferty, które nie są drzwiami: klamki, wizjery, zawiasy,
// nakładki, ościeżnice. Trafiły tam, bo feedParser gubił <category_main>,
// a categorizeDoor to denylista — wszystko nierozpoznane zostawało 'residential'.
// Oba źródła są już naprawione; ten skrypt sprząta dane sprzed poprawki.
//
// Bezpieczny i idempotentny: kasuje WYŁĄCZNIE id, które feed jawnie oznacza
// kategorią nie-drzwiową. Brak kategorii = drzwi (patrz isDoorProduct).
//
// Podgląd bez kasowania:  DRY_RUN=1 npx ts-node --transpile-only src/scripts/purgeNonDoors.ts
// Uruchomienie:           cd backend && npx ts-node --transpile-only src/scripts/purgeNonDoors.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { parseFeedStreaming } from '../services/feedParser'
import { isDoorProduct } from '../services/chromaService'

const FEED_URL = process.env.FEED_URL ?? 'https://www.porta.com.pl/product-feed.xml'
const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  console.log(`[PURGE] Feed: ${FEED_URL}${DRY_RUN ? ' (DRY RUN — nic nie kasuję)' : ''}`)
  const { products } = await parseFeedStreaming(FEED_URL, {
    onProgress: (n) => {
      if (n % 2000 === 0) console.log(`[PURGE] parsowanie: ${n}`)
    },
  })

  const nonDoors = products.filter((p) => !isDoorProduct(p.categoryMain))
  const byCategory = new Map<string, number>()
  for (const p of nonDoors) {
    const c = p.categoryMain ?? '(brak)'
    byCategory.set(c, (byCategory.get(c) ?? 0) + 1)
  }
  console.log(`[PURGE] Feed: ${products.length} ofert, w tym ${nonDoors.length} nie-drzwi:`)
  for (const [cat, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${cat}`)
  }

  const client = new ChromaClient({ path: 'http://localhost:8000' })
  const col = await client.getCollection({ name: 'products' })
  const before = await col.count()

  // Kasujemy tylko te, które faktycznie są w bazie — żeby raport był prawdziwy.
  const ids = nonDoors.map((p) => p.id)
  const present: string[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const r = await col.get({ ids: ids.slice(i, i + 200) })
    present.push(...r.ids)
  }
  console.log(`[PURGE] W bazie: ${before} rekordów, do usunięcia: ${present.length}`)

  if (present.length === 0) {
    console.log('[PURGE] Nic do zrobienia — katalog czysty.')
    return
  }
  if (DRY_RUN) {
    console.log('[PURGE] DRY RUN — kończę bez zmian.')
    return
  }

  for (let i = 0; i < present.length; i += 200) {
    await col.delete({ ids: present.slice(i, i + 200) })
    console.log(`[PURGE] usunięto ${Math.min(i + 200, present.length)}/${present.length}`)
  }

  const after = await col.count()
  console.log(`[PURGE] GOTOWE. ${before} → ${after} (usunięto ${before - after}).`)
}

main().catch((err) => {
  console.error('[PURGE] Błąd:', err)
  process.exit(1)
})
