import { ChromaClient, Collection } from 'chromadb'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const COLLECTION_NAME = 'products'
const LOW_SIMILARITY_THRESHOLD = 0.3

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

export async function searchSimilar(
  embedding: number[],
  n: number = 5,
): Promise<{ results: SearchResultItem[]; isLowSimilarity: boolean }> {
  const col = await getCollection()
  const count = await col.count()

  if (count === 0) {
    return { results: [], isLowSimilarity: false }
  }

  const queryResults = await col.query({
    queryEmbeddings: [embedding],
    nResults: Math.min(n, count),
  })

  const results: SearchResultItem[] = (queryResults.ids[0] ?? []).map((id, i) => {
    const distance = queryResults.distances?.[0]?.[i] ?? 1
    const similarity = 1 - distance
    const metadata = queryResults.metadatas[0][i] as unknown as ProductMetadata
    return { id, similarity, metadata }
  })

  const topSimilarity = results[0]?.similarity ?? 0
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

export async function isChromaHealthy(): Promise<boolean> {
  try {
    await client.heartbeat()
    return true
  } catch {
    return false
  }
}
