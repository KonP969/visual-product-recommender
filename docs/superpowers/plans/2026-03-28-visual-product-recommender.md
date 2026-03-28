# Visual Product Recommender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować MVP aplikacji do wyszukiwania produktów na podstawie podobieństwa wizualnego — upload zdjęcia → CLIP embedding → ChromaDB search → wyniki.

**Architecture:** Monorepo z trzema warstwami: React frontend (Vite + shadcn/ui), Node.js/Express backend jako REST API, Python FastAPI sidecar serwujący model CLIP ViT-B/32. ChromaDB przechowuje embeddingi produktów i obsługuje similarity search.

**Tech Stack:** React 18 + TypeScript + Vite + shadcn/ui + TailwindCSS, Node.js + Express + TypeScript, Python 3.10+ + FastAPI + transformers (CLIP), ChromaDB

---

## Struktura plików

```
visual-product-recommender/
├── .gitignore
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── components.json                  ← shadcn config
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css                    ← Tailwind directives
│       ├── types/
│       │   └── index.ts                 ← Product, SearchResult, ApiResponse, AppState
│       ├── lib/
│       │   ├── utils.ts                 ← cn() helper
│       │   ├── api.ts                   ← fetch wrapper do /api/*
│       │   └── mockApi.ts               ← mock do dev bez backendu
│       ├── hooks/
│       │   ├── useFileUpload.ts         ← walidacja + preview URL
│       │   └── useSearch.ts             ← wywołanie API + stan aplikacji
│       └── components/
│           ├── ui/                      ← shadcn: card, button, badge
│           ├── Header.tsx
│           ├── Footer.tsx
│           ├── DropZone.tsx
│           ├── ProductCard.tsx
│           ├── ResultsGrid.tsx
│           └── SearchResults.tsx
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                     ← Express app + port 3001
│       ├── middleware/
│       │   └── errorHandler.ts
│       ├── routes/
│       │   ├── health.ts                ← GET /api/health
│       │   ├── catalog.ts               ← GET /api/catalog/stats
│       │   ├── search.ts                ← POST /api/search
│       │   └── import.ts                ← POST /api/import
│       └── services/
│           ├── clipService.ts           ← HTTP klient do Python sidecar :8001
│           └── chromaService.ts         ← klient ChromaDB :8000
└── python-sidecar/
    ├── requirements.txt
    └── main.py                          ← FastAPI + CLIP model
```

---

## ETAP 1 — Scaffolding

### Task 1: Inicjalizacja git i .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Krok 1: Inicjalizacja git w katalogu głównym projektu**

```bash
cd "C:/Users/Konrad/Documents/__projects_and_git_repo_clones/Procuct_reco_base_on_img"
git init
```

Oczekiwany output: `Initialized empty Git repository in ...`

- [ ] **Krok 2: Utwórz `.gitignore`**

```
# Node
node_modules/
dist/
.env
*.log

# Python
__pycache__/
*.py[cod]
.venv/
venv/
*.egg-info/

# Vite
frontend/dist/
frontend/.vite/

# ChromaDB
chroma_db/
*.chroma

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
```

- [ ] **Krok 3: Commit**

```bash
git add .gitignore
git commit -m "chore: init repo with gitignore"
```

---

### Task 2: Scaffolding frontendu — Vite + React + TypeScript

**Files:**
- Create: `frontend/` (wygenerowany przez Vite)

- [ ] **Krok 1: Utwórz projekt Vite**

```bash
cd "C:/Users/Konrad/Documents/__projects_and_git_repo_clones/Procuct_reco_base_on_img"
npm create vite@latest frontend -- --template react-ts
```

Oczekiwany output: `Scaffolding project in .../frontend...` + `Done.`

- [ ] **Krok 2: Zainstaluj zależności**

```bash
cd frontend
npm install
```

- [ ] **Krok 3: Zweryfikuj że dev server działa**

```bash
npm run dev
```

Oczekiwany output: `VITE v5.x.x  ready in ... ms` + `➜  Local: http://localhost:5173/`

Zatrzymaj serwer (Ctrl+C).

- [ ] **Krok 4: Commit**

```bash
cd ..
git add frontend/
git commit -m "chore: scaffold Vite React TypeScript frontend"
```

---

### Task 3: Konfiguracja shadcn/ui i TailwindCSS

**Files:**
- Create: `frontend/components.json`
- Modify: `frontend/src/index.css`
- Modify: `frontend/vite.config.ts`

- [ ] **Krok 1: Uruchom shadcn init**

```bash
cd frontend
npx shadcn@latest init
```

Odpowiedz na pytania:
- Style: **New York**
- Base color: **Neutral**
- CSS variables: **Yes**

Oczekiwany output: `✔ Writing components.json` + `✔ Initializing project`

- [ ] **Krok 2: Dodaj komponenty shadcn**

```bash
npx shadcn@latest add card button badge
```

Oczekiwany output: `✔ Done.` dla każdego komponentu. Pliki pojawią się w `src/components/ui/`.

- [ ] **Krok 3: Skonfiguruj proxy w `vite.config.ts`**

Zastąp zawartość pliku `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Krok 4: Zainstaluj `@types/node` (potrzebne dla `path`)**

```bash
npm install -D @types/node
```

- [ ] **Krok 5: Zweryfikuj że dev server nadal działa**

```bash
npm run dev
```

Oczekiwany output: `VITE v5.x.x  ready` bez błędów. Zatrzymaj (Ctrl+C).

- [ ] **Krok 6: Commit**

```bash
cd ..
git add frontend/
git commit -m "chore: configure shadcn/ui, Tailwind, and Vite proxy"
```

---

### Task 4: Scaffolding backendu — Node.js + Express + TypeScript

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/src/index.ts`

- [ ] **Krok 1: Utwórz katalog i `package.json`**

```bash
cd "C:/Users/Konrad/Documents/__projects_and_git_repo_clones/Procuct_reco_base_on_img"
mkdir backend
cd backend
npm init -y
```

- [ ] **Krok 2: Zainstaluj zależności**

```bash
npm install express multer cors axios
npm install -D typescript @types/node @types/express @types/multer @types/cors ts-node-dev
```

- [ ] **Krok 3: Utwórz `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Krok 4: Dodaj skrypt `dev` do `backend/package.json`**

W sekcji `"scripts"` dodaj:

```json
"scripts": {
  "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js"
}
```

- [ ] **Krok 5: Utwórz `backend/src/index.ts`**

```typescript
import express from 'express'
import cors from 'cors'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
```

- [ ] **Krok 6: Zweryfikuj że backend startuje**

```bash
npm run dev
```

Oczekiwany output: `Backend running on http://localhost:3001`

Zatrzymaj (Ctrl+C).

- [ ] **Krok 7: Commit**

```bash
cd ..
git add backend/
git commit -m "chore: scaffold Node.js Express TypeScript backend"
```

---

### Task 5: Scaffolding Python sidecar

**Files:**
- Create: `python-sidecar/requirements.txt`
- Create: `python-sidecar/main.py`

- [ ] **Krok 1: Utwórz katalog i `requirements.txt`**

```bash
cd "C:/Users/Konrad/Documents/__projects_and_git_repo_clones/Procuct_reco_base_on_img"
mkdir python-sidecar
```

Utwórz plik `python-sidecar/requirements.txt`:

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
torch==2.3.0
transformers==4.41.0
Pillow==10.3.0
python-multipart==0.0.9
```

- [ ] **Krok 2: Utwórz `python-sidecar/main.py`**

```python
from fastapi import FastAPI, UploadFile, File, HTTPException
from contextlib import asynccontextmanager
import torch
from transformers import CLIPProcessor, CLIPModel
from PIL import Image
import io

model = None
processor = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, processor
    print("Loading CLIP model...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()
    print("CLIP model loaded.")
    yield
    model = None
    processor = None


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/embed")
async def embed(file: UploadFile = File(...)):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        features = model.get_image_features(**inputs)
        features = features / features.norm(dim=-1, keepdim=True)

    return {"embedding": features[0].tolist()}
```

- [ ] **Krok 3: Utwórz i aktywuj virtualenv, zainstaluj zależności**

```bash
cd python-sidecar
python -m venv venv
# Windows:
venv\Scripts\activate
pip install -r requirements.txt
```

Oczekiwany output: `Successfully installed fastapi uvicorn torch transformers Pillow ...`

- [ ] **Krok 4: Zweryfikuj że sidecar startuje**

```bash
uvicorn main:app --port 8001
```

Oczekiwany output: `Loading CLIP model...` → `CLIP model loaded.` → `Uvicorn running on http://0.0.0.0:8001`

Zatrzymaj (Ctrl+C).

- [ ] **Krok 5: Commit**

```bash
cd ..
git add python-sidecar/requirements.txt python-sidecar/main.py
git commit -m "chore: scaffold Python FastAPI CLIP sidecar"
```

---

## ETAP 2 — Frontend: typy, hooks, komponenty

### Task 6: Typy TypeScript

**Files:**
- Create: `frontend/src/types/index.ts`

- [ ] **Krok 1: Utwórz `frontend/src/types/index.ts`**

```typescript
export interface Product {
  id: string
  name: string
  price: string
  imageUrl: string
  productUrl?: string
  similarity: number
}

export interface SearchResult {
  products: Product[]
  status: 'success' | 'empty-catalog' | 'low-similarity'
}

export interface ApiResponse<T> {
  data?: T
  error?: string
}

export type AppState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'empty-catalog'
  | 'low-similarity'

export interface FileValidationError {
  type: 'invalid-type' | 'too-large'
  message: string
}
```

- [ ] **Krok 2: Commit**

```bash
git add frontend/src/types/
git commit -m "feat: add TypeScript types"
```

---

### Task 7: Lib — utils, api client, mock API

**Files:**
- Create: `frontend/src/lib/utils.ts`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/mockApi.ts`

- [ ] **Krok 1: Sprawdź czy shadcn już wygenerował `utils.ts`**

Otwórz `frontend/src/lib/utils.ts`. Shadcn zazwyczaj tworzy go z `cn()`. Jeśli istnieje, pomiń krok 2.

- [ ] **Krok 2: Jeśli nie istnieje — utwórz `frontend/src/lib/utils.ts`**

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Zainstaluj jeśli brakuje: `npm install clsx tailwind-merge`

- [ ] **Krok 3: Utwórz `frontend/src/lib/api.ts`**

```typescript
import { ApiResponse, SearchResult } from '@/types'

const BASE_URL = '/api'

export async function searchByImage(file: File): Promise<ApiResponse<SearchResult>> {
  const formData = new FormData()
  formData.append('image', file)

  try {
    const response = await fetch(`${BASE_URL}/search`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      return { error: error.error ?? 'Server error' }
    }

    const data = await response.json()
    return { data }
  } catch {
    return { error: 'Network error. Is the backend running?' }
  }
}

export async function getCatalogStats(): Promise<ApiResponse<{ count: number }>> {
  try {
    const response = await fetch(`${BASE_URL}/catalog/stats`)
    if (!response.ok) return { error: 'Failed to fetch stats' }
    const data = await response.json()
    return { data }
  } catch {
    return { error: 'Network error' }
  }
}
```

- [ ] **Krok 4: Utwórz `frontend/src/lib/mockApi.ts`**

```typescript
import { ApiResponse, SearchResult } from '@/types'

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
```

- [ ] **Krok 5: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat: add api client, mock api, and utils"
```

---

### Task 8: Hook useFileUpload

**Files:**
- Create: `frontend/src/hooks/useFileUpload.ts`

- [ ] **Krok 1: Utwórz `frontend/src/hooks/useFileUpload.ts`**

```typescript
import { useState, useCallback } from 'react'
import { FileValidationError } from '@/types'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

interface UseFileUploadReturn {
  file: File | null
  previewUrl: string | null
  validationError: FileValidationError | null
  handleFile: (file: File) => void
  reset: () => void
}

export function useFileUpload(): UseFileUploadReturn {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<FileValidationError | null>(null)

  const handleFile = useCallback((newFile: File) => {
    setValidationError(null)

    if (!ACCEPTED_TYPES.includes(newFile.type)) {
      setValidationError({
        type: 'invalid-type',
        message: 'Please upload an image file (JPG, PNG, or WEBP).',
      })
      return
    }

    if (newFile.size > MAX_SIZE_BYTES) {
      setValidationError({
        type: 'too-large',
        message: 'Image must be under 10 MB.',
      })
      return
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    setFile(newFile)
    setPreviewUrl(URL.createObjectURL(newFile))
  }, [previewUrl])

  const reset = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setFile(null)
    setPreviewUrl(null)
    setValidationError(null)
  }, [previewUrl])

  return { file, previewUrl, validationError, handleFile, reset }
}
```

- [ ] **Krok 2: Commit**

```bash
git add frontend/src/hooks/useFileUpload.ts
git commit -m "feat: add useFileUpload hook with validation"
```

---

### Task 9: Hook useSearch

**Files:**
- Create: `frontend/src/hooks/useSearch.ts`

- [ ] **Krok 1: Utwórz `frontend/src/hooks/useSearch.ts`**

```typescript
import { useState, useCallback } from 'react'
import { AppState, SearchResult } from '@/types'
import { mockSearchByImage } from '@/lib/mockApi'

const USE_MOCK = true // przełącz na false po podłączeniu backendu

interface UseSearchReturn {
  appState: AppState
  searchResult: SearchResult | null
  search: (file: File) => Promise<void>
  reset: () => void
}

export function useSearch(): UseSearchReturn {
  const [appState, setAppState] = useState<AppState>('idle')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)

  const search = useCallback(async (file: File) => {
    setAppState('loading')
    setSearchResult(null)

    const searchFn = USE_MOCK
      ? mockSearchByImage
      : (await import('@/lib/api')).searchByImage

    const response = await searchFn(file)

    if (response.error) {
      setAppState('error')
      return
    }

    const result = response.data!

    if (result.products.length === 0) {
      setAppState('empty-catalog')
      return
    }

    setSearchResult(result)
    setAppState(result.status === 'low-similarity' ? 'low-similarity' : 'success')
  }, [])

  const reset = useCallback(() => {
    setAppState('idle')
    setSearchResult(null)
  }, [])

  return { appState, searchResult, search, reset }
}
```

- [ ] **Krok 2: Commit**

```bash
git add frontend/src/hooks/useSearch.ts
git commit -m "feat: add useSearch hook"
```

---

### Task 10: Komponenty Header i Footer

**Files:**
- Create: `frontend/src/components/Header.tsx`
- Create: `frontend/src/components/Footer.tsx`

- [ ] **Krok 1: Utwórz `frontend/src/components/Header.tsx`**

```typescript
import { Github } from 'lucide-react'

export function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="text-sm font-semibold tracking-tight text-gray-900">
            Visual Product Recommender
          </span>
        </div>
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900"
        >
          <Github className="h-3.5 w-3.5" />
          GitHub
        </a>
      </div>
    </header>
  )
}
```

- [ ] **Krok 2: Zainstaluj lucide-react jeśli brakuje**

```bash
cd frontend
npm install lucide-react
```

- [ ] **Krok 3: Utwórz `frontend/src/components/Footer.tsx`**

```typescript
export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span className="text-xs text-gray-400">
          Built with CLIP + ChromaDB
        </span>
        <span className="text-xs text-gray-400">Konrad P.</span>
      </div>
    </footer>
  )
}
```

- [ ] **Krok 4: Commit**

```bash
git add frontend/src/components/Header.tsx frontend/src/components/Footer.tsx
git commit -m "feat: add Header and Footer components"
```

---

### Task 11: Komponent DropZone

**Files:**
- Create: `frontend/src/components/DropZone.tsx`

- [ ] **Krok 1: Utwórz `frontend/src/components/DropZone.tsx`**

```typescript
import { useRef, useState, DragEvent, ChangeEvent } from 'react'
import { Upload, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FileValidationError } from '@/types'

interface DropZoneProps {
  previewUrl: string | null
  validationError: FileValidationError | null
  onFile: (file: File) => void
}

export function DropZone({ previewUrl, validationError, onFile }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex h-64 w-full max-w-lg cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all',
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50',
        )}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Preview"
            className="h-full w-full rounded-2xl object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-white p-3 shadow-sm">
              {isDragging ? (
                <ImageIcon className="h-6 w-6 text-blue-500" />
              ) : (
                <Upload className="h-6 w-6 text-gray-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Drop your image here
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                or click to upload · JPG, PNG, WEBP · max 10 MB
              </p>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>
      {validationError && (
        <p className="text-sm text-red-500">{validationError.message}</p>
      )}
    </div>
  )
}
```

- [ ] **Krok 2: Commit**

```bash
git add frontend/src/components/DropZone.tsx
git commit -m "feat: add DropZone component with drag and drop"
```

---

### Task 12: Komponent ProductCard

**Files:**
- Create: `frontend/src/components/ProductCard.tsx`

- [ ] **Krok 1: Utwórz `frontend/src/components/ProductCard.tsx`**

```typescript
import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Product } from '@/types'

interface ProductCardProps {
  product: Product
}

export function ProductCard({ product }: ProductCardProps) {
  const similarityPercent = Math.round(product.similarity * 100)

  const content = (
    <Card className="group overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-md">
      <div className="relative aspect-square overflow-hidden bg-gray-50">
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute right-2 top-2">
          <Badge variant="secondary" className="text-xs font-medium">
            {similarityPercent}%
          </Badge>
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-gray-900">{product.name}</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">{product.price}</span>
          {product.productUrl && (
            <ExternalLink className="h-3.5 w-3.5 text-gray-400 group-hover:text-blue-500" />
          )}
        </div>
      </div>
    </Card>
  )

  if (product.productUrl) {
    return (
      <a href={product.productUrl} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    )
  }

  return content
}
```

- [ ] **Krok 2: Commit**

```bash
git add frontend/src/components/ProductCard.tsx
git commit -m "feat: add ProductCard component"
```

---

### Task 13: Komponenty ResultsGrid i SearchResults

**Files:**
- Create: `frontend/src/components/ResultsGrid.tsx`
- Create: `frontend/src/components/SearchResults.tsx`

- [ ] **Krok 1: Utwórz `frontend/src/components/ResultsGrid.tsx`**

```typescript
import { Product } from '@/types'
import { ProductCard } from './ProductCard'

interface ResultsGridProps {
  products: Product[]
}

export function ResultsGrid({ products }: ResultsGridProps) {
  return (
    <div className="animate-in fade-in duration-500">
      <p className="mb-4 text-sm text-gray-500">
        {products.length} matching product{products.length !== 1 ? 's' : ''} found
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Krok 2: Utwórz `frontend/src/components/SearchResults.tsx`**

```typescript
import { Loader2, AlertCircle, PackageSearch, SearchX } from 'lucide-react'
import { AppState, SearchResult } from '@/types'
import { ResultsGrid } from './ResultsGrid'

interface SearchResultsProps {
  appState: AppState
  searchResult: SearchResult | null
}

export function SearchResults({ appState, searchResult }: SearchResultsProps) {
  if (appState === 'idle') return null

  if (appState === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Searching for similar products…</p>
      </div>
    )
  }

  if (appState === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-500">Something went wrong. Please try again.</p>
      </div>
    )
  }

  if (appState === 'empty-catalog') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
        <PackageSearch className="h-8 w-8" />
        <p className="text-sm">No products in catalog. Import a product feed to get started.</p>
      </div>
    )
  }

  if (!searchResult) return null

  return (
    <div>
      {appState === 'low-similarity' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <SearchX className="h-4 w-4 flex-shrink-0" />
          We couldn't find a close match. Try a different photo.
        </div>
      )}
      <ResultsGrid products={searchResult.products} />
    </div>
  )
}
```

- [ ] **Krok 3: Commit**

```bash
git add frontend/src/components/ResultsGrid.tsx frontend/src/components/SearchResults.tsx
git commit -m "feat: add ResultsGrid and SearchResults components"
```

---

### Task 14: Złożenie App.tsx i weryfikacja UI

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Krok 1: Zastąp zawartość `frontend/src/App.tsx`**

```typescript
import { useFileUpload } from '@/hooks/useFileUpload'
import { useSearch } from '@/hooks/useSearch'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { DropZone } from '@/components/DropZone'
import { SearchResults } from '@/components/SearchResults'

export default function App() {
  const { file, previewUrl, validationError, handleFile } = useFileUpload()
  const { appState, searchResult, search } = useSearch()

  const handleFileSelected = (newFile: File) => {
    handleFile(newFile)
    if (!validationError) {
      search(newFile)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Find products by photo
          </h1>
          <p className="text-sm text-gray-500">
            Upload any image and discover visually similar products
          </p>
        </div>
        <div className="flex flex-col items-center gap-8">
          <DropZone
            previewUrl={previewUrl}
            validationError={validationError}
            onFile={handleFileSelected}
          />
          {file && appState === 'idle' && (
            <button
              onClick={() => search(file)}
              className="rounded-full bg-blue-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              Search
            </button>
          )}
        </div>
        <SearchResults appState={appState} searchResult={searchResult} />
      </main>
      <Footer />
    </div>
  )
}
```

- [ ] **Krok 2: Upewnij się że `frontend/src/index.css` zawiera dyrektywy Tailwind**

Plik powinien zaczynać się od (shadcn zazwyczaj to ustawia):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Jeśli nie — zastąp zawartość pliku tymi trzema liniami i wklej poniżej resztę wygenerowanych zmiennych CSS od shadcn.

- [ ] **Krok 3: Uruchom dev server i zweryfikuj UI**

```bash
cd frontend
npm run dev
```

Otwórz `http://localhost:5173`. Oczekiwane:
- Header z kropką i "Visual Product Recommender"
- Strefa drag & drop
- Footer

Upuść dowolny obraz JPG/PNG — po ~1.2s powinny pojawić się mocky 5 kart produktów.

- [ ] **Krok 4: Commit**

```bash
cd ..
git add frontend/src/App.tsx frontend/src/index.css
git commit -m "feat: compose App.tsx, frontend MVP with mock data working"
```

---

## ETAP 3 — Backend: Express endpoints

### Task 15: Middleware i struktura tras

**Files:**
- Create: `backend/src/middleware/errorHandler.ts`
- Modify: `backend/src/index.ts`

- [ ] **Krok 1: Utwórz `backend/src/middleware/errorHandler.ts`**

```typescript
import { Request, Response, NextFunction } from 'express'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[ERROR]', err.stack)
  res.status(500).json({ error: 'Internal server error' })
}
```

- [ ] **Krok 2: Utwórz katalogi tras i serwisów**

```bash
cd backend
mkdir -p src/routes src/services src/middleware
```

- [ ] **Krok 3: Zaktualizuj `backend/src/index.ts`**

```typescript
import express from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/errorHandler'
import { healthRouter } from './routes/health'
import { catalogRouter } from './routes/catalog'
import { searchRouter } from './routes/search'
import { importRouter } from './routes/import'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

app.use('/api', healthRouter)
app.use('/api', catalogRouter)
app.use('/api', searchRouter)
app.use('/api', importRouter)

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})
```

- [ ] **Krok 4: Commit**

```bash
cd ..
git add backend/src/
git commit -m "feat: add backend middleware and route structure"
```

---

### Task 16: Serwis clipService

**Files:**
- Create: `backend/src/services/clipService.ts`

- [ ] **Krok 1: Zainstaluj `form-data`**

```bash
cd backend
npm install form-data
npm install -D @types/form-data
```

- [ ] **Krok 2: Utwórz `backend/src/services/clipService.ts`**

```typescript
import axios from 'axios'
import FormData from 'form-data'

const SIDECAR_URL = process.env.CLIP_SIDECAR_URL ?? 'http://localhost:8001'

export async function getEmbedding(imageBuffer: Buffer, mimetype: string): Promise<number[]> {
  const form = new FormData()
  form.append('file', imageBuffer, {
    filename: 'image',
    contentType: mimetype,
  })

  const response = await axios.post<{ embedding: number[] }>(
    `${SIDECAR_URL}/embed`,
    form,
    { headers: form.getHeaders() },
  )

  return response.data.embedding
}

export async function isSidecarHealthy(): Promise<boolean> {
  try {
    const response = await axios.get<{ status: string }>(`${SIDECAR_URL}/health`, {
      timeout: 3000,
    })
    return response.data.status === 'ok'
  } catch {
    return false
  }
}
```

- [ ] **Krok 2: Commit**

```bash
git add backend/src/services/clipService.ts
git commit -m "feat: add CLIP sidecar HTTP client"
```

---

### Task 17: Serwis chromaService

**Files:**
- Create: `backend/src/services/chromaService.ts`

- [ ] **Krok 1: Zainstaluj klient ChromaDB**

```bash
cd backend
npm install chromadb
```

- [ ] **Krok 2: Utwórz `backend/src/services/chromaService.ts`**

```typescript
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

export async function upsertProduct(
  id: string,
  embedding: number[],
  metadata: ProductMetadata,
): Promise<void> {
  const col = await getCollection()
  await col.upsert({
    ids: [id],
    embeddings: [embedding],
    metadatas: [metadata as Record<string, string>],
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
```

- [ ] **Krok 3: Commit**

```bash
cd ..
git add backend/src/services/chromaService.ts
git commit -m "feat: add ChromaDB service client"
```

---

### Task 18: Route GET /api/health

**Files:**
- Create: `backend/src/routes/health.ts`

- [ ] **Krok 1: Utwórz `backend/src/routes/health.ts`**

```typescript
import { Router } from 'express'
import { isSidecarHealthy } from '../services/clipService'
import { isChromaHealthy } from '../services/chromaService'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res, next) => {
  try {
    const [chroma, sidecar] = await Promise.all([
      isChromaHealthy(),
      isSidecarHealthy(),
    ])

    const allHealthy = chroma && sidecar
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'ok' : 'degraded',
      services: {
        backend: true,
        chromadb: chroma,
        clip_sidecar: sidecar,
      },
    })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Krok 2: Commit**

```bash
git add backend/src/routes/health.ts
git commit -m "feat: add GET /api/health endpoint"
```

---

### Task 19: Route GET /api/catalog/stats

**Files:**
- Create: `backend/src/routes/catalog.ts`

- [ ] **Krok 1: Utwórz `backend/src/routes/catalog.ts`**

```typescript
import { Router } from 'express'
import { getProductCount } from '../services/chromaService'

export const catalogRouter = Router()

catalogRouter.get('/catalog/stats', async (_req, res, next) => {
  try {
    const count = await getProductCount()
    res.json({ count })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Krok 2: Commit**

```bash
git add backend/src/routes/catalog.ts
git commit -m "feat: add GET /api/catalog/stats endpoint"
```

---

### Task 20: Route POST /api/search

**Files:**
- Create: `backend/src/routes/search.ts`

- [ ] **Krok 1: Utwórz `backend/src/routes/search.ts`**

```typescript
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
```

- [ ] **Krok 2: Commit**

```bash
git add backend/src/routes/search.ts
git commit -m "feat: add POST /api/search endpoint"
```

---

### Task 21: Route POST /api/import

**Files:**
- Create: `backend/src/routes/import.ts`

- [ ] **Krok 1: Utwórz `backend/src/routes/import.ts`**

```typescript
import { Router } from 'express'
import path from 'path'
import { runImport } from '../services/importService'

export const importRouter = Router()

importRouter.post('/import', async (req, res, next) => {
  try {
    const { feedPath } = req.body as { feedPath?: string }

    if (!feedPath) {
      res.status(400).json({ error: 'feedPath is required' })
      return
    }

    const absolutePath = path.resolve(feedPath)
    res.json({ message: 'Import started', path: absolutePath })

    runImport(absolutePath).catch((err: Error) => {
      console.error('[IMPORT ERROR]', err.stack)
    })
  } catch (err) {
    next(err)
  }
})
```

Uwaga: `importService` zostanie dodany w Etapie 6. Na razie route zwraca 200 i loguje błąd jeśli serwis nie istnieje.

- [ ] **Krok 2: Utwórz placeholder `backend/src/services/importService.ts`**

```typescript
export async function runImport(_feedPath: string): Promise<void> {
  throw new Error('Import service not yet implemented')
}
```

- [ ] **Krok 3: Commit**

```bash
git add backend/src/routes/import.ts backend/src/services/importService.ts
git commit -m "feat: add POST /api/import endpoint with placeholder service"
```

---

## ETAP 4 — Python Sidecar: już gotowy z Tasku 5

Python sidecar został zaimplementowany w Task 5. Etap 4 jest ukończony.

---

## ETAP 5 — ChromaDB: uruchomienie i weryfikacja

### Task 22: Instalacja i uruchomienie ChromaDB

**Files:** brak (lokalna usługa)

- [ ] **Krok 1: Zainstaluj ChromaDB przez pip**

```bash
pip install chromadb
```

- [ ] **Krok 2: Uruchom serwer ChromaDB**

```bash
chroma run --path ./chroma_db --port 8000
```

Oczekiwany output: `Starting Chroma server on port 8000`

Zostaw działający w osobnym terminalu.

- [ ] **Krok 3: Zweryfikuj że backend może połączyć się z ChromaDB**

Uruchom backend (osobny terminal):

```bash
cd backend
npm run dev
```

Wywołaj health check:

```bash
curl http://localhost:3001/api/health
```

Oczekiwany output (przy wyłączonym sidecar):

```json
{
  "status": "degraded",
  "services": { "backend": true, "chromadb": true, "clip_sidecar": false }
}
```

`chromadb: true` potwierdza połączenie.

- [ ] **Krok 4: Commit**

```bash
git add .
git commit -m "chore: add chroma_db to gitignore, verify ChromaDB connection"
```

---

## ETAP 6 — Import XML

### Task 23: Parser XML i pobieranie obrazów

**Files:**
- Create: `backend/src/services/feedParser.ts`
- Create: `backend/src/services/imageDownloader.ts`

- [ ] **Krok 1: Zainstaluj xml2js**

```bash
cd backend
npm install xml2js
npm install -D @types/xml2js
```

- [ ] **Krok 2: Utwórz `backend/src/services/feedParser.ts`**

```typescript
import { parseStringPromise } from 'xml2js'
import { readFile } from 'fs/promises'

export interface FeedProduct {
  id: string
  name: string
  imageUrl: string
  price: string
  productUrl?: string
}

export async function parseFeed(filePath: string): Promise<FeedProduct[]> {
  const xml = await readFile(filePath, 'utf-8')
  const parsed = await parseStringPromise(xml, { explicitArray: false })

  // Obsługa formatu Google Merchant / Ceneo
  const channel = parsed?.rss?.channel ?? parsed?.feed
  const rawItems: Record<string, unknown>[] = channel?.item ?? channel?.entry ?? []

  const items = Array.isArray(rawItems) ? rawItems : [rawItems]

  return items
    .map((item, idx): FeedProduct | null => {
      const name =
        (item['g:title'] as string) ??
        (item['title'] as string) ??
        null

      const imageUrl =
        (item['g:image_link'] as string) ??
        (item['image_link'] as string) ??
        null

      const price =
        (item['g:price'] as string) ??
        (item['price'] as string) ??
        '—'

      const productUrl =
        (item['g:link'] as string) ??
        (item['link'] as string) ??
        undefined

      const id =
        (item['g:id'] as string) ??
        (item['id'] as string) ??
        String(idx)

      if (!name || !imageUrl) return null

      return { id, name, imageUrl, price, productUrl }
    })
    .filter((p): p is FeedProduct => p !== null)
}
```

- [ ] **Krok 3: Utwórz `backend/src/services/imageDownloader.ts`**

```typescript
import axios from 'axios'

const TIMEOUT_MS = 10_000

export async function downloadImage(url: string): Promise<{ buffer: Buffer; mimetype: string }> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'VisualProductRecommender/1.0' },
  })

  const mimetype = (response.headers['content-type'] as string | undefined)
    ?.split(';')[0]
    ?.trim() ?? 'image/jpeg'

  return { buffer: Buffer.from(response.data), mimetype }
}
```

- [ ] **Krok 4: Commit**

```bash
cd ..
git add backend/src/services/feedParser.ts backend/src/services/imageDownloader.ts
git commit -m "feat: add XML feed parser and image downloader"
```

---

### Task 24: Serwis importu end-to-end

**Files:**
- Modify: `backend/src/services/importService.ts`

- [ ] **Krok 1: Zastąp zawartość `backend/src/services/importService.ts`**

```typescript
import { parseFeed } from './feedParser'
import { downloadImage } from './imageDownloader'
import { getEmbedding } from './clipService'
import { upsertProduct } from './chromaService'

export async function runImport(feedPath: string): Promise<void> {
  console.log(`[IMPORT] Parsing feed: ${feedPath}`)
  const products = await parseFeed(feedPath)
  console.log(`[IMPORT] Found ${products.length} products`)

  let success = 0
  let failed = 0

  for (let i = 0; i < products.length; i++) {
    const product = products[i]
    const progress = `[${i + 1}/${products.length}]`

    try {
      const { buffer, mimetype } = await downloadImage(product.imageUrl)
      const embedding = await getEmbedding(buffer, mimetype)
      await upsertProduct(product.id, embedding, {
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
      })
      success++
      console.log(`[IMPORT] ${progress} ✓ ${product.name}`)
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[IMPORT] ${progress} ✗ ${product.name} — ${message}`)
    }
  }

  console.log(
    `[IMPORT] Done. Total: ${products.length} | Success: ${success} | Failed: ${failed}`,
  )
}
```

- [ ] **Krok 2: Commit**

```bash
git add backend/src/services/importService.ts
git commit -m "feat: implement XML import service with progress logging"
```

---

## ETAP 7 — Integracja end-to-end

### Task 25: Podłączenie frontendu do prawdziwego API

**Files:**
- Modify: `frontend/src/hooks/useSearch.ts`

- [ ] **Krok 1: Zmień flagę `USE_MOCK` na `false` w `frontend/src/hooks/useSearch.ts`**

```typescript
const USE_MOCK = false // było: true
```

- [ ] **Krok 2: Uruchom wszystkie 3 usługi (każda w osobnym terminalu)**

Terminal 1 — ChromaDB:
```bash
chroma run --path ./chroma_db --port 8000
```

Terminal 2 — Python sidecar:
```bash
cd python-sidecar
venv\Scripts\activate
uvicorn main:app --port 8001
```

Terminal 3 — Backend:
```bash
cd backend
npm run dev
```

Terminal 4 — Frontend:
```bash
cd frontend
npm run dev
```

- [ ] **Krok 3: Zweryfikuj health check**

```bash
curl http://localhost:3001/api/health
```

Oczekiwany output:

```json
{
  "status": "ok",
  "services": { "backend": true, "chromadb": true, "clip_sidecar": true }
}
```

- [ ] **Krok 4: Przetestuj pełny flow**

1. Otwórz `http://localhost:5173`
2. Wgraj plik XML feed przez: `curl -X POST http://localhost:3001/api/import -H "Content-Type: application/json" -d "{\"feedPath\": \"./test-feed.xml\"}"`
3. Poczekaj na zakończenie importu (śledź logi backendu)
4. Sprawdź stats: `curl http://localhost:3001/api/catalog/stats`
5. Upuść zdjęcie w UI — powinny pojawić się prawdziwe wyniki w < 2s

- [ ] **Krok 5: Commit**

```bash
git add frontend/src/hooks/useSearch.ts
git commit -m "feat: switch frontend to real API, integration complete"
```

---

### Task 26: Weryfikacja edge case'ów

**Files:** brak zmian w kodzie — weryfikacja manualna

- [ ] **ST-301 — Błędny typ pliku:** Upuść plik `.pdf` → UI pokazuje "Please upload an image file (JPG, PNG, or WEBP)."

- [ ] **ST-302 — Za duży plik:** Spróbuj wgrać plik > 10 MB → UI pokazuje "Image must be under 10 MB."

- [ ] **ST-303 — Pusty katalog:** Wyczyść ChromaDB i wgraj zdjęcie → UI pokazuje "No products in catalog. Import a product feed to get started."

  Aby wyczyścić ChromaDB:
  ```bash
  curl -X DELETE http://localhost:8000/api/v1/collections/products
  ```

- [ ] **ST-304 — Słabe dopasowanie:** Wgraj zdjęcie bardzo odmienne od katalogu → UI pokazuje ostrzeżenie "We couldn't find a close match."

- [ ] **ST-305 — Backend niedostępny:** Zatrzymaj backend, wgraj zdjęcie → UI pokazuje "Something went wrong. Please try again."

- [ ] **Commit po weryfikacji:**

```bash
git commit --allow-empty -m "chore: verify all edge cases ST-301 through ST-305"
```

---

## ETAP 8 — Polish i dokumentacja

### Task 27: README

**Files:**
- Create: `README.md`

- [ ] **Krok 1: Utwórz `README.md` w katalogu głównym**

```markdown
# Visual Product Recommender

Upload any photo and instantly get matched products from a catalog based on visual similarity, powered by CLIP embeddings and ChromaDB.

## Architecture

```
Frontend (React + Vite)  →  Backend (Node.js/Express)  →  Python Sidecar (FastAPI + CLIP)
                                       ↕
                                  ChromaDB
```

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + shadcn/ui + TailwindCSS |
| Backend | Node.js + Express + TypeScript |
| Embedding | CLIP ViT-B/32 via FastAPI |
| Vector DB | ChromaDB |

## Running locally

### Prerequisites
- Node.js 18+
- Python 3.10+

### 1. Start ChromaDB

```bash
pip install chromadb
chroma run --path ./chroma_db --port 8000
```

### 2. Start Python sidecar

```bash
cd python-sidecar
python -m venv venv && venv\Scripts\activate  # Windows
pip install -r requirements.txt
uvicorn main:app --port 8001
```

### 3. Start backend

```bash
cd backend
npm install
npm run dev
```

### 4. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### 5. Import a product catalog

```bash
curl -X POST http://localhost:3001/api/import \
  -H "Content-Type: application/json" \
  -d '{"feedPath": "./path/to/feed.xml"}'
```
```

- [ ] **Krok 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with architecture and quickstart"
```

---

### Task 28: Weryfikacja responsywności

**Files:** brak

- [ ] **Krok 1: Otwórz DevTools w przeglądarce (F12)**

- [ ] **Krok 2: Sprawdź widok tablet (768px)**

Ustaw szerokość 768px. Oczekiwane:
- DropZone mieści się na ekranie
- Siatka produktów: 3 kolumny

- [ ] **Krok 3: Sprawdź widok desktop (1280px)**

- Siatka produktów: 5 kolumn

- [ ] **Krok 4: Commit (jeśli były poprawki CSS)**

```bash
git add frontend/src/
git commit -m "fix: responsive layout adjustments"
```

---

### Task 29: Commit końcowy i tag wersji

- [ ] **Krok 1: Upewnij się że wszystko jest zacommitowane**

```bash
git status
```

Oczekiwany output: `nothing to commit, working tree clean`

- [ ] **Krok 2: Tag MVP**

```bash
git tag -a v0.1.0 -m "MVP: visual product recommender with CLIP + ChromaDB"
```

- [ ] **Krok 3: Gotowe**

```bash
git log --oneline
```

Powinieneś zobaczyć czysty log commitów od scaffoldingu przez wszystkie etapy.
```
