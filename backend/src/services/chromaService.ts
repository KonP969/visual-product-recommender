import { ChromaClient, Collection } from 'chromadb'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const COLLECTION_NAME = 'products'
// Calibrated for text↔text CLIP embeddings (post-reindex): good matches score 0.90+.
const LOW_SIMILARITY_THRESHOLD = 0.85

const client = new ChromaClient({ path: CHROMA_URL })
let collection: Collection | null = null

async function getCollection(): Promise<Collection> {
  if (!collection) {
    collection = await client.getOrCreateCollection({ name: COLLECTION_NAME })
  }
  return collection
}

export interface ProductMetadata {
  name: string
  price: string
  imageUrl: string
  productUrl?: string
  description?: string
  category?: 'residential' | 'specialty'
  currency?: string
}

export interface SearchResultItem {
  id: string
  similarity: number
  metadata: ProductMetadata
}

// Patterns that identify non-residential specialty/commercial door types by product name.
const COMMERCIAL_DOOR_PATTERNS = [
  /akustyczn/i,       // acoustic doors (Akustyczne, akustyczna)
  /\d{2,}\s*db/i,     // acoustic rating (42 dB, 32 dB)
  /\brc\s*[2-6]\b/i,  // security class (RC2, RC3, RC4)
  /steel\s+solid/i,   // Steel SOLID brand (external steel doors)
  /granit\s*c\b/i,    // GRANIT C brand (external security doors)
  /extreme\s*rc/i,    // EXTREME RC (anti-burglary)
  /przeciwpoż/i,      // fire-rated doors
]

export function categorizeDoor(name: string): 'residential' | 'specialty' {
  return COMMERCIAL_DOOR_PATTERNS.some((p) => p.test(name)) ? 'specialty' : 'residential'
}

export async function productExists(id: string): Promise<boolean> {
  const col = await getCollection()
  const result = await col.get({ ids: [id] })
  return result.ids.length > 0
}

export async function upsertProduct(
  id: string,
  embedding: number[],
  metadata: ProductMetadata,
): Promise<void> {
  const col = await getCollection()
  await col.upsert({
    ids: [id],
    embeddings: [embedding],
    metadatas: [metadata as unknown as Record<string, string>],
  })
  nameIndex = null // new product invalidates the name-search index
}

// Cosine similarity between two L2-normalized vectors
function cosineSim(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

// Maximal Marginal Relevance: picks k diverse results from a larger candidate pool.
// lambda=1 → pure relevance; lambda=0 → pure diversity; 0.7 is a good default.
export function applyMMR(
  candidates: Array<SearchResultItem & { embedding: number[] }>,
  k: number,
  lambda = 0.7,
): SearchResultItem[] {
  const selected: Array<SearchResultItem & { embedding: number[] }> = []
  const remaining = [...candidates]

  while (selected.length < k && remaining.length > 0) {
    let bestScore = -Infinity
    let bestIdx = 0

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].similarity
      const maxRedundancy =
        selected.length > 0
          ? Math.max(...selected.map((s) => cosineSim(remaining[i].embedding, s.embedding)))
          : 0
      const score = lambda * relevance - (1 - lambda) * maxRedundancy
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    selected.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }

  return selected.map(({ id, similarity, metadata }) => ({ id, similarity, metadata }))
}

interface CandidateItem extends SearchResultItem {
  embedding: number[]
}

async function queryCandidates(
  embedding: number[],
  candidateN: number,
  where?: Record<string, string>,
): Promise<CandidateItem[]> {
  const col = await getCollection()
  const queryResults = await col.query({
    queryEmbeddings: [embedding],
    nResults: candidateN,
    where,
    include: ['embeddings', 'metadatas', 'distances'] as any,
  })

  return (queryResults.ids[0] ?? []).map((id, i) => {
    const distance = queryResults.distances?.[0]?.[i] ?? 2
    const similarity = Math.max(0, 1 - distance / 2)
    const metadata = queryResults.metadatas[0][i] as unknown as ProductMetadata
    const emb = (queryResults.embeddings?.[0]?.[i] as number[]) ?? []
    return { id, similarity, metadata, embedding: emb }
  })
}

export async function searchSimilar(
  embedding: number[],
  n: number = 5,
  candidateMultiplier = 5,
): Promise<{ results: SearchResultItem[]; isLowSimilarity: boolean }> {
  const col = await getCollection()
  const count = await col.count()

  if (count === 0) {
    return { results: [], isLowSimilarity: false }
  }

  // Fetch a larger candidate pool so MMR has room to diversify
  const candidateN = Math.min(n * candidateMultiplier, count)

  // Native metadata filter keeps the pool clean at the DB level. Products
  // imported before the category backfill lack the field and would be excluded
  // by `where`, so an empty result falls back to a name-pattern post-filter.
  let candidates = await queryCandidates(embedding, candidateN, { category: 'residential' })
  if (candidates.length === 0) {
    const all = await queryCandidates(embedding, candidateN)
    candidates = all.filter((c) => categorizeDoor(c.metadata.name) === 'residential')
  }

  const topSimilarity = candidates[0]?.similarity ?? 0
  const results = applyMMR(candidates, n)

  return {
    results,
    isLowSimilarity: topSimilarity < LOW_SIMILARITY_THRESHOLD,
  }
}

export async function getProductEmbedding(
  id: string,
): Promise<{ metadata: ProductMetadata; embedding: number[] } | null> {
  const col = await getCollection()
  const result = await col.get({ ids: [id], include: ['metadatas', 'embeddings'] })
  if (result.ids.length === 0) return null
  return {
    metadata: result.metadatas[0] as unknown as ProductMetadata,
    embedding: result.embeddings![0] as number[],
  }
}

export async function listProducts(
  limit: number = 20,
  offset: number = 0,
): Promise<{ id: string; metadata: ProductMetadata }[]> {
  const col = await getCollection()
  const result = await col.get({ limit, offset, include: ['metadatas'] })
  return result.ids.map((id, i) => ({
    id,
    metadata: result.metadatas[i] as unknown as ProductMetadata,
  }))
}

export async function getProductCount(): Promise<number> {
  const col = await getCollection()
  return col.count()
}

// Lightweight in-memory index so name search doesn't scan the whole collection
// on every keystroke. Rebuilt lazily, invalidated on upsert.
let nameIndex: Array<{ id: string; name: string }> | null = null

async function getNameIndex(): Promise<Array<{ id: string; name: string }>> {
  if (nameIndex) return nameIndex

  const col = await getCollection()
  const BATCH = 500
  const index: Array<{ id: string; name: string }> = []
  let offset = 0

  while (true) {
    const result = await col.get({ limit: BATCH, offset, include: ['metadatas'] })
    if (result.ids.length === 0) break
    for (let i = 0; i < result.ids.length; i++) {
      const metadata = result.metadatas[i] as unknown as ProductMetadata
      index.push({ id: result.ids[i], name: metadata.name })
    }
    offset += result.ids.length
    if (result.ids.length < BATCH) break
  }

  nameIndex = index
  return index
}

export async function searchProductsByName(
  query: string,
  limit: number,
  offset: number,
): Promise<{ products: { id: string; metadata: ProductMetadata }[]; total: number }> {
  const q = query.toLowerCase()
  const index = await getNameIndex()
  const matchedIds = index.filter((e) => e.name.toLowerCase().includes(q)).map((e) => e.id)

  const total = matchedIds.length
  const pageIds = matchedIds.slice(offset, offset + limit)
  if (pageIds.length === 0) return { products: [], total }

  const col = await getCollection()
  const result = await col.get({ ids: pageIds, include: ['metadatas'] })
  // col.get does not guarantee input order — restore it
  const byId = new Map(
    result.ids.map((id, i) => [id, result.metadatas[i] as unknown as ProductMetadata]),
  )
  const products = pageIds
    .filter((id) => byId.has(id))
    .map((id) => ({ id, metadata: byId.get(id)! }))
  return { products, total }
}

export async function isChromaHealthy(): Promise<boolean> {
  try {
    await client.heartbeat()
    return true
  } catch {
    return false
  }
}
