import type { ApiResponse, SearchResult } from '@/types'

const MOCK_PRODUCTS = [
  {
    id: '1',
    name: 'Fotel skandynawski dębowy',
    price: '899 zł',
    imageUrl: 'https://picsum.photos/seed/chair1/300/300',
    productUrl: 'https://example.com/product/1',
    similarity: 0.92,
  },
  {
    id: '2',
    name: 'Lampa stojąca minimalistyczna',
    price: '349 zł',
    imageUrl: 'https://picsum.photos/seed/lamp1/300/300',
    productUrl: 'https://example.com/product/2',
    similarity: 0.85,
  },
  {
    id: '3',
    name: 'Stolik kawowy marmur',
    price: '1 299 zł',
    imageUrl: 'https://picsum.photos/seed/table1/300/300',
    productUrl: 'https://example.com/product/3',
    similarity: 0.78,
  },
  {
    id: '4',
    name: 'Poduszka dekoracyjna lniana',
    price: '89 zł',
    imageUrl: 'https://picsum.photos/seed/pillow1/300/300',
    similarity: 0.71,
  },
  {
    id: '5',
    name: 'Dywan wełniany geometryczny',
    price: '599 zł',
    imageUrl: 'https://picsum.photos/seed/rug1/300/300',
    productUrl: 'https://example.com/product/5',
    similarity: 0.65,
  },
]

export async function mockSearchByImage(_file: File): Promise<ApiResponse<SearchResult>> {
  await new Promise((resolve) => setTimeout(resolve, 1200))
  return {
    data: {
      products: MOCK_PRODUCTS,
      status: 'success',
    },
  }
}
