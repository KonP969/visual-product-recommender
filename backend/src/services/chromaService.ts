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
}

export interface SearchResultItem {
  id: string
  similarity: number
  metadata: ProductMetadata
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
}

// Cosine similarity between two L2-normalized vectors
function cosineSim(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

// Maximal Marginal Relevance: picks k diverse results from a larger candidate pool.
// lambda=1 → pure relevance; lambda=0 → pure diversity; 0.7 is a good default.
function applyMMR(
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

// Patterns that identify non-residential specialty/commercial door types by product name.
// These are filtered out from residential interior search results.
const COMMERCIAL_DOOR_PATTERNS = [
  /akustyczn/i,       // acoustic doors (Akustyczne, akustyczna)
  /\d{2,}\s*db/i,     // acoustic rating (42 dB, 32 dB)
  /\brc\s*[2-6]\b/i,  // security class (RC2, RC3, RC4)
  /steel\s+solid/i,   // Steel SOLID brand (external steel doors)
  /granit\s*c\b/i,    // GRANIT C brand (external security doors)
  /extreme\s*rc/i,    // EXTREME RC (anti-burglary)
  /przeciwpoż/i,      // fire-rated doors
]

function isResidentialDoor(name: string): boolean {
  return !COMMERCIAL_DOOR_PATTERNS.some((p) => p.test(name))
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

  // Fetch a larger candidate pool so MMR + residential filter have room to work
  const candidateN = Math.min(n * candidateMultiplier, count)

  const queryResults = await col.query({
    queryEmbeddings: [embedding],
    nResults: candidateN,
    include: ['embeddings', 'metadatas', 'distances'] as any,
  })

  const allCandidates: Array<SearchResultItem & { embedding: number[] }> = (
    queryResults.ids[0] ?? []
  ).map((id, i) => {
    const distance = queryResults.distances?.[0]?.[i] ?? 2
    const similarity = Math.max(0, 1 - distance / 2)
    const metadata = queryResults.metadatas[0][i] as unknown as ProductMetadata
    const emb = (queryResults.embeddings?.[0]?.[i] as number[]) ?? []
    return { id, similarity, metadata, embedding: emb }
  })

  // Filter out non-residential products before MMR so diversity picks from clean pool
  const candidates = allCandidates.filter((c) => isResidentialDoor(c.metadata.name))

  const topSimilarity = allCandidates[0]?.similarity ?? 0
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

export async function searchProductsByName(
  query: string,
  limit: number,
  offset: number,
): Promise<{ products: { id: string; metadata: ProductMetadata }[]; total: number }> {
  const col = await getCollection()
  const q = query.toLowerCase()
  const BATCH = 500
  const matched: { id: string; metadata: ProductMetadata }[] = []
  let batchOffset = 0

  while (true) {
    const result = await col.get({ limit: BATCH, offset: batchOffset, include: ['metadatas'] })
    if (result.ids.length === 0) break

    for (let i = 0; i < result.ids.length; i++) {
      const metadata = result.metadatas[i] as unknown as ProductMetadata
      if (metadata.name.toLowerCase().includes(q)) {
        matched.push({ id: result.ids[i], metadata })
      }
    }

    batchOffset += result.ids.length
    if (result.ids.length < BATCH) break
  }

  const total = matched.length
  const products = matched.slice(offset, offset + limit)
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
