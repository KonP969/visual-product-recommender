import { createHash } from 'crypto'
import { ChromaClient, Collection } from 'chromadb'
import type { Style } from './attributeService'
import { finishMatches } from './attributeService'

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
  color_family?: string
  has_glass?: boolean
  lightness?: number
  style_klasyczny?: boolean
  style_nowoczesny?: boolean
  style_minimalistyczny?: boolean
  style_rustykalny?: boolean
  style_loft?: boolean
  style_skandynawski?: boolean
  style_glamour?: boolean
  style_none?: boolean
}

export interface HardFilters {
  colors?: string[] | null
  glass?: boolean | null
  style?: Style | null
  /** gatunek wybarwienia ("orzech", "dab") — filtr po nazwie, nie po metadanej */
  finish?: string | null
}

export interface SearchResultItem {
  id: string
  similarity: number
  metadata: ProductMetadata
  /** liczba wariantów o tej samej nazwie w puli (>=1) */
  variantCount?: number
  /** cena najtańszego wariantu w grupie (string, jak metadata.price) */
  priceFrom?: string
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
  /steel\s*safe/i,    // STEEL SAFE brand (reinforced entrance doors, category_main empty in feed)
  /przesuwny\s+bezości[eę]żnicow/i, // bezościeżnicowy sliding system (category_main empty in feed)
]

export function categorizeDoor(name: string): 'residential' | 'specialty' {
  return COMMERCIAL_DOOR_PATTERNS.some((p) => p.test(name)) ? 'specialty' : 'residential'
}

// Kategorie feedu, które NIE są drzwiami wewnętrznymi: klamki/akcesoria/
// ościeżnice (to nie skrzydło drzwiowe) oraz — decyzja eksperta domenowego,
// docs/otwarte-zadania.md §1 — drzwi wejściowe, techniczne, przesuwne i
// składane (to skrzydła, ale nie do wnętrza mieszkania). Bez tego trafiają
// do katalogu jako drzwi — bo categorizeDoor to denylista po NAZWIE i
// wszystko nierozpoznane domyślnie zostaje 'residential'.
const NON_DOOR_CATEGORIES = new Set([
  'klamki',
  'akcesoria',
  'ościeżnice',
  'drzwi wejściowe do mieszkania',
  'drzwi techniczne',
  'drzwi przesuwne',
  'drzwi składane',
])

/**
 * Czy oferta z feedu jest drzwiami? Rozstrzyga `category_main`.
 * Brak kategorii oznacza DRZWI — w feedzie Porty ~379 realnych modeli
 * (PORTA UNI KOLOR MODERN, CLASSIC C.2, KWARC) nie ma tego pola, więc
 * odsiewanie po jego braku skasowałoby prawdziwe produkty.
 */
export function isDoorProduct(categoryMain?: string | null): boolean {
  if (!categoryMain) return true
  return !NON_DOOR_CATEGORIES.has(categoryMain.trim().toLowerCase())
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
  nameCounts = null
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

  return selected.map(({ embedding, ...rest }) => rest)
}

// Warianty tego samego model+koloru (różne linie/ceny) mają w feedzie IDENTYCZNĄ
// nazwę — w siatce wyglądają jak powtórki. Zwijamy je do jednego reprezentanta
// (najlepiej dopasowanego), z ceną „od" (najtańszy w grupie) i licznikiem.
// Dane w Chromie zostają — to tylko prezentacja. Wejście jest już posortowane
// rankingiem, więc pierwsze wystąpienie nazwy = najlepszy wariant.
export function dedupeByName<T extends SearchResultItem & { embedding: number[] }>(
  candidates: T[],
): Array<T & { variantCount: number; priceFrom: string }> {
  const rep = new Map<string, T>()
  const count = new Map<string, number>()
  const minPrice = new Map<string, number>()
  const minPriceStr = new Map<string, string>()
  for (const c of candidates) {
    const name = c.metadata.name
    count.set(name, (count.get(name) ?? 0) + 1)
    const p = Number(c.metadata.price)
    if (!Number.isNaN(p) && p < (minPrice.get(name) ?? Infinity)) {
      minPrice.set(name, p)
      minPriceStr.set(name, c.metadata.price)
    }
    if (!rep.has(name)) rep.set(name, c)
  }
  return [...rep.values()].map((c) => ({
    ...c,
    variantCount: count.get(c.metadata.name)!,
    priceFrom: minPriceStr.get(c.metadata.name) ?? c.metadata.price,
  }))
}

// docs/manual-review-checklist.md §F: "N wariantów do wyboru" na karcie mylił
// użytkownika, bo dedupeByName liczy tylko duplikaty nazwy W PULI TEGO wyszukiwania
// (garstka kandydatów podobieństwa), nie prawdziwą liczbę wariantów modelu w całym
// katalogu — więc karta prawie nigdy nie zgadzała się z konfiguratorem. Ta funkcja
// nadpisuje variantCount PO całym rankingu, prawdziwą liczbą z indeksu nazw
// (getNameCounts, ten sam cache co przy wyszukiwaniu po nazwie) — dedupeByName
// i jego testy zostają nietknięte, bo swojej roboty (wybór reprezentanta + cena
// „od") nadal robią dobrze.
export function applyTrueVariantCounts<T extends SearchResultItem>(
  results: T[],
  totalCounts: Map<string, number>,
): T[] {
  return results.map((r) => ({
    ...r,
    variantCount: totalCounts.get(r.metadata.name) ?? r.variantCount,
  }))
}

interface CandidateItem extends SearchResultItem {
  embedding: number[]
}

// Buduje natywny filtr Chroma: kategoria + twarde ograniczenia koloru/szkła.
// Similarity nie umie negacji ani gwarancji koloru — to robi `where`.
export function buildWhere(filters?: HardFilters): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [{ category: 'residential' }]
  if (filters?.colors && filters.colors.length > 0) {
    conditions.push({ color_family: { $in: filters.colors } })
  }
  if (filters?.glass === true || filters?.glass === false) {
    conditions.push({ has_glass: filters.glass })
  }
  if (filters?.style) {
    // Twardo: sam styl. Wcześniej stało tu "$or [styl, style_none]" — furtka dla
    // drzwi z ubogim opisem (425 wariantów, 5% katalogu). Po przejściu na styl per
    // model zostało ich 26 (0,3%), a furtka kosztowała dwie rzeczy: liczba na chipie
    // przestawała odpowiadać liście, a bezstylowe potrafiły wyprzedzić prawdziwe
    // trafienia w rankingu. Pusty przekrój ma teraz jawny komunikat (resolveStyleFilter),
    // więc podstawienie odbywa się otwarcie, a nie po cichu w warunku where.
    conditions.push({ ['style_' + filters.style]: true })
  }
  return conditions.length === 1 ? conditions[0] : { $and: conditions }
}

async function queryCandidates(
  embedding: number[],
  candidateN: number,
  where?: Record<string, unknown>,
): Promise<CandidateItem[]> {
  const col = await getCollection()
  const queryResults = await col.query({
    queryEmbeddings: [embedding],
    nResults: candidateN,
    where: where as any,
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

// Deterministyczny jitter rankingu: kandydaci o niemal identycznym similarity
// (np. 0.95 vs 0.953) są praktycznie równoważni, a bez tego dwa podobne
// wnętrza dostają identyczne top-N. Seed (hash zdjęcia / tekst zapytania)
// tasuje remisy inaczej dla każdego zapytania — powtarzalnie.
const JITTER_RANGE = 0.012

export function applySeededJitter<T extends { id: string; similarity: number }>(
  candidates: T[],
  seed: string,
): T[] {
  return candidates
    .map((c) => {
      const h = createHash('sha256').update(`${seed}:${c.id}`).digest()
      const unit = h.readUInt32BE(0) / 0xffffffff // [0,1]
      return { ...c, similarity: c.similarity + (unit - 0.5) * JITTER_RANGE }
    })
    .sort((a, b) => b.similarity - a.similarity)
}

export async function searchSimilar(
  embedding: number[],
  n: number = 5,
  filters?: HardFilters,
  seed?: string,
  candidateMultiplier = 5,
): Promise<{
  results: SearchResultItem[]
  isLowSimilarity: boolean
  /** wybarwienie, o które proszono, ale nie ma go w puli — do pokazania userowi */
  droppedFinish?: string
}> {
  const col = await getCollection()
  const count = await col.count()

  if (count === 0) {
    return { results: [], isLowSimilarity: false }
  }

  // Fetch a larger candidate pool so MMR has room to diversify.
  // Wybarwienie odsiewa po nazwie już PO pobraniu, więc pula musi być większa.
  const effMultiplier = filters?.finish ? candidateMultiplier * 8 : candidateMultiplier
  const candidateN = Math.min(n * effMultiplier, count)

  // Twarde filtry są nienegocjowalne: gdy dają mniej wyników, zwracamy mniej —
  // nigdy nie dopełniamy produktami łamiącymi ograniczenia użytkownika.
  let candidates = await queryCandidates(embedding, candidateN, buildWhere(filters))

  // Awaryjnie (dane sprzed backfillu kategorii): tylko gdy nie było filtrów.
  if (candidates.length === 0 && !filters?.colors && filters?.glass == null && filters?.style == null) {
    const all = await queryCandidates(embedding, candidateN)
    candidates = all.filter((c) => categorizeDoor(c.metadata.name) === 'residential')
  }

  // Gatunek wybarwienia: rodzina koloru go nie rozróżnia ("Dąb Ciemny" i
  // "Orzech Ciemny" to oba dark_wood), więc odsiewamy po nazwie wariantu.
  // Pusty wynik oznaczałby ślepą uliczkę — wtedy wolimy całą rodzinę koloru.
  let droppedFinish: string | undefined
  if (filters?.finish) {
    const byFinish = candidates.filter((c) => finishMatches(c.metadata.name, filters.finish!))
    if (byFinish.length > 0) {
      candidates = byFinish
    } else {
      // Milczące pominięcie filtra wygląda jak awaria wyszukiwarki — mówimy wprost.
      droppedFinish = filters.finish
      console.warn(`[CHROMA] Brak wariantow o wybarwieniu "${filters.finish}" — pomijam filtr`)
    }
  }

  // isLowSimilarity liczymy PRZED jitterem — z prawdziwego similarity
  const topSimilarity = candidates[0]?.similarity ?? 0

  const ranked = seed ? applySeededJitter(candidates, seed) : candidates
  const deduped = dedupeByName(ranked)
  const results = applyMMR(deduped, n)
  const totalCounts = await getNameCounts()

  return {
    results: applyTrueVariantCounts(results, totalCounts),
    isLowSimilarity: topSimilarity < LOW_SIMILARITY_THRESHOLD,
    droppedFinish,
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

// Prawdziwa liczba wystąpień nazwy w CAŁYM katalogu — patrz applyTrueVariantCounts.
// Ten sam cykl życia co nameIndex (jedno źródło, jedna invalidacja przy upsercie).
let nameCounts: Map<string, number> | null = null

async function getNameCounts(): Promise<Map<string, number>> {
  if (nameCounts) return nameCounts
  const index = await getNameIndex()
  const counts = new Map<string, number>()
  for (const { name } of index) counts.set(name, (counts.get(name) ?? 0) + 1)
  nameCounts = counts
  return counts
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
