# Visual Product Recommender — Design Spec

**Data:** 2026-03-28
**Status:** Zatwierdzona
**PRD:** `PRD-visual-product-recommender.md`

---

## 1. Cel projektu

Aplikacja MVP do wyszukiwania produktów na podstawie podobieństwa wizualnego. Użytkownik wgrywa zdjęcie, aplikacja zwraca listę podobnych produktów z katalogu — zasilana CLIP embeddings i ChromaDB.

Cel dodatkowy: czysty kod, nowoczesne UI i architektura gotowa na skalowanie.

---

## 2. Struktura repozytorium (monorepo)

```
visual-product-recommender/
├── frontend/                        ← Vite + React 18 + TypeScript
│   ├── src/
│   │   ├── components/ui/           ← shadcn/ui komponenty
│   │   ├── components/              ← DropZone, ProductCard, ResultsGrid, Header, Footer
│   │   ├── lib/                     ← utils (cn), api client, mockApi
│   │   ├── hooks/                   ← useFileUpload, useSearch
│   │   ├── types/                   ← Product, SearchResult, ApiResponse, AppState
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts               ← proxy /api → localhost:3001
├── backend/                         ← Node.js + Express + TypeScript
│   ├── src/
│   │   ├── routes/                  ← search.ts, import.ts, health.ts
│   │   ├── services/                ← chromaService.ts, clipService.ts
│   │   └── index.ts
│   └── package.json
└── python-sidecar/                  ← FastAPI + CLIP ViT-B/32
    ├── main.py
    └── requirements.txt
```

---

## 3. Sekwencja scaffoldingu

1. `npm create vite@latest frontend -- --template react-ts`
2. `cd frontend && npx shadcn@latest init` (New York style, CSS variables)
3. Dodanie komponentów shadcn: `card`, `button`, `badge`
4. Konfiguracja proxy w `vite.config.ts`
5. Ręczne tworzenie `backend/` i `python-sidecar/`
6. Inicjalizacja git, `.gitignore` dla wszystkich warstw

---

## 4. Architektura

```
Frontend (React)
    ↓ POST /api/search (multipart)
Backend (Node.js / Express :3001)
    ↓ POST /embed (base64 image)          ↓ query(vector, n)
Python Sidecar (FastAPI :8001)       ChromaDB (:8000)
    CLIP ViT-B/32                        kolekcja produktów
```

### API endpoints

| Method | Endpoint | Opis |
|--------|----------|------|
| POST | `/api/search` | Przyjmuje obraz multipart, zwraca `Product[]` |
| GET | `/api/health` | Status backendu + ChromaDB + Python sidecar |
| GET | `/api/catalog/stats` | Liczba produktów w katalogu |
| POST | `/api/import` | Uruchamia import z XML feed |

---

## 5. Komponenty frontendowe

```
App.tsx
├── Header                    ← nazwa + link GitHub
├── DropZone                  ← drag & drop, walidacja, preview
├── SearchResults             ← obsługa stanów UI
│   └── ProductCard[]         ← obraz, nazwa, cena, link
└── Footer
```

### Stany UI

| Stan | Wyświetlane |
|------|-------------|
| `idle` | tylko DropZone |
| `loading` | spinner |
| `success` | siatka ProductCard |
| `error` | "Something went wrong. Please try again." |
| `empty-catalog` | "No products in catalog. Import a product feed to get started." |
| `low-similarity` | "We couldn't find a close match. Try a different photo." |

### Hooks

- `useFileUpload` — walidacja (JPG/PNG/WEBP, ≤10MB), generowanie preview URL
- `useSearch` — wywołanie POST /api/search, zarządzanie stanem aplikacji

---

## 6. Typy TypeScript

```typescript
interface Product {
  id: string
  name: string
  price: string
  imageUrl: string
  productUrl?: string
  similarity: number
}

interface SearchResult {
  products: Product[]
  status: 'success' | 'empty-catalog' | 'low-similarity'
}

interface ApiResponse<T> {
  data?: T
  error?: string
}

type AppState = 'idle' | 'loading' | 'success' | 'error' | 'empty-catalog' | 'low-similarity'
```

---

## 7. Python Sidecar

- Model: CLIP ViT-B/32 (open-source, bez kosztów)
- Framework: FastAPI + uvicorn
- Endpoint `POST /embed` — przyjmuje obraz, zwraca wektor 512-dim
- Endpoint `GET /health` — status modelu
- Ładowanie modelu przy starcie (raz, trzymany w pamięci)

---

## 8. ChromaDB

- Kolekcja: `products`
- Metadane na dokumencie: `name`, `price`, `imageUrl`, `productUrl`
- Top-N domyślnie: 5–10
- Próg low-similarity: cosine similarity < 0.3
- Docelowa skala MVP: do 10 000 produktów

---

## 9. Import XML

- Format: Google Merchant / Ceneo
- Pola: `name`, `image_url`, `price`, `product_url`
- Pobieranie obrazów z retry i timeout
- Skip + warning dla niedostępnych URL
- Podsumowanie: total / sukces / błędy
- CLI: `node import.js --feed path/to/feed.xml`

---

## 10. Design UI

- **Styl:** minimalistyczny, Apple-inspired, białe tło
- **Font:** Inter
- **Akcent:** blue-500 (`#3B82F6`)
- **Animacje:** fade-in na wyniki, scale 1.02 na hover kart
- **Responsywność:** desktop + tablet

---

## 11. Etapy implementacji (przegląd)

| Etap | Zakres |
|------|--------|
| 1 | Scaffolding — Vite, shadcn, git, struktura monorepo |
| 2 | Frontend — komponenty, hooks, typy, mock API |
| 3 | Backend — Express, endpoints, middleware |
| 4 | Python sidecar — FastAPI, CLIP model |
| 5 | ChromaDB — klient, upsert, search, stats |
| 6 | Import XML — parser, pobieranie obrazów, embeddingi |
| 7 | Integracja end-to-end — podłączenie, testy flow |
| 8 | Polish — README, diagramy, skrypt startowy |

---

## 12. Ścieżka post-MVP

- CLIP → Vertex AI Multimodal Embeddings
- ChromaDB → BigQuery VECTOR_SEARCH
- Local → Cloud Run (backend) + Vercel (frontend)
