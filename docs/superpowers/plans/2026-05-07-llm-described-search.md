# LLM-Described Visual Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken "image-of-room → search-against-product-image-embeddings" pipeline with "image-of-room → Gemini Flash describes the desired door → CLIP text encoder embeds that description → search against existing product image embeddings in ChromaDB."

**Architecture:** Exploit CLIP's native cross-modal alignment (text and image embeddings live in the same 512-D space). The product catalogue stays exactly as it is — no re-import needed. Only the query side changes: a multimodal LLM (Gemini 2.0 Flash) extracts a concise, door-focused description from the user's interior photo, and CLIP's text encoder produces a query vector in the same space as the stored product image vectors.

**Tech Stack:** Existing — React/Vite frontend, Express/TypeScript backend, FastAPI/CLIP sidecar, ChromaDB. Adding — `@google/generative-ai` SDK, `dotenv`, CLIP text encoder (already part of the loaded `CLIPProcessor`/`CLIPModel`).

---

## File Structure

**Created:**
- `backend/src/services/geminiService.ts` — calls Gemini 2.0 Flash with the uploaded image, returns a short door-focused description
- `backend/.env.example` — documents required env vars
- `backend/.env` — actual API key (git-ignored)

**Modified:**
- `python-sidecar/main.py` — add `POST /embed-text` endpoint
- `backend/src/services/clipService.ts` — add `getTextEmbedding(text)` calling the new sidecar endpoint
- `backend/src/routes/search.ts` — rewire pipeline: image → Gemini → CLIP text → ChromaDB
- `backend/src/index.ts` — load `dotenv` at top
- `backend/package.json` — add `@google/generative-ai` and `dotenv` deps
- `frontend/src/types/index.ts` — add `description` field to `SearchResult`
- `frontend/src/components/SearchResults.tsx` — render the description above the grid
- `.gitignore` — add `backend/.env`

---

## Task 1: Add `/embed-text` endpoint to the Python sidecar

**Files:**
- Modify: `python-sidecar/main.py`

- [ ] **Step 1: Add a Pydantic request model and a new endpoint**

Replace the contents of `python-sidecar/main.py` with:

```python
from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
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


class TextRequest(BaseModel):
    text: str


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


@app.post("/embed-text")
async def embed_text(req: TextRequest):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    inputs = processor(text=[text], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        features = model.get_text_features(**inputs)
        features = features / features.norm(dim=-1, keepdim=True)

    return {"embedding": features[0].tolist()}
```

- [ ] **Step 2: Restart the sidecar and smoke-test**

```bash
# In terminal 2 (sidecar terminal), Ctrl+C then:
uvicorn main:app --port 8001
```

In a fresh shell:

```bash
curl -X POST http://localhost:8001/embed-text -H "Content-Type: application/json" -d "{\"text\": \"a white modern matte interior door\"}"
```

Expected: JSON with `embedding` field, an array of 512 floats.

- [ ] **Step 3: Commit**

```bash
git add python-sidecar/main.py
git commit -m "feat(sidecar): add /embed-text endpoint using CLIP text encoder"
```

---

## Task 2: Add `dotenv` and `@google/generative-ai` to backend

**Files:**
- Modify: `backend/package.json` (via npm)
- Modify: `backend/src/index.ts`
- Create: `backend/.env.example`
- Create: `backend/.env`
- Modify: `.gitignore`

- [ ] **Step 1: Install dependencies**

```bash
cd backend
npm install dotenv @google/generative-ai
```

- [ ] **Step 2: Load `.env` at the very top of `backend/src/index.ts`**

Replace the imports block at the top of `backend/src/index.ts` with:

```ts
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/errorHandler'
import { healthRouter } from './routes/health'
import { catalogRouter } from './routes/catalog'
import { searchRouter } from './routes/search'
import { importRouter } from './routes/import'
```

(rest of the file unchanged)

- [ ] **Step 3: Create `backend/.env.example`**

```
# Google AI Studio API key for Gemini Flash (room interior → door description)
# Get one at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your-key-here
```

- [ ] **Step 4: Create `backend/.env` with the real key**

The user provides their real `GEMINI_API_KEY` — write it into `backend/.env` with the same `GEMINI_API_KEY=...` line.

- [ ] **Step 5: Add `backend/.env` to `.gitignore`**

Append to root `.gitignore`:

```
backend/.env
```

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/index.ts backend/.env.example .gitignore
git commit -m "chore(backend): add dotenv + @google/generative-ai, env loading"
```

---

## Task 3: Build `geminiService.ts`

**Files:**
- Create: `backend/src/services/geminiService.ts`

- [ ] **Step 1: Write the service**

```ts
import { GoogleGenerativeAI } from '@google/generative-ai'

const MODEL_NAME = 'gemini-2.0-flash'

const PROMPT = `You are helping match interior doors to a room's style.

Look at this interior photo and produce ONE short English phrase (max 20 words) describing the type of interior door that would best fit this room. Focus only on the door's visual properties:
- color and material (e.g. "white", "oak veneer", "dark walnut")
- finish (matte / gloss / wood grain)
- style (modern flat panel / classic raised panel / minimalist / rustic)

Output ONLY the description, no preamble, no quotes, no punctuation other than commas. Example outputs:
"white modern flat panel matte interior door"
"dark oak classic raised panel wooden door"
"minimalist light grey frameless interior door"`

let client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (client) return client
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY not set — copy backend/.env.example to backend/.env and fill it in')
  }
  client = new GoogleGenerativeAI(key)
  return client
}

export async function describeRoomForDoorMatching(
  imageBuffer: Buffer,
  mimetype: string,
): Promise<string> {
  const model = getClient().getGenerativeModel({ model: MODEL_NAME })

  const result = await model.generateContent([
    { text: PROMPT },
    {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimetype,
      },
    },
  ])

  const text = result.response.text().trim()
  if (!text) {
    throw new Error('Gemini returned empty description')
  }
  return text
}
```

- [ ] **Step 2: Type-check**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/geminiService.ts
git commit -m "feat(backend): add Gemini Flash service for room→door description"
```

---

## Task 4: Add `getTextEmbedding` to `clipService.ts`

**Files:**
- Modify: `backend/src/services/clipService.ts`

- [ ] **Step 1: Append the function**

Add this export at the end of `backend/src/services/clipService.ts`:

```ts
export async function getTextEmbedding(text: string): Promise<number[]> {
  const response = await axios.post<{ embedding: number[] }>(
    `${SIDECAR_URL}/embed-text`,
    { text },
    { headers: { 'Content-Type': 'application/json' } },
  )
  return response.data.embedding
}
```

- [ ] **Step 2: Type-check**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/clipService.ts
git commit -m "feat(backend): add getTextEmbedding helper hitting sidecar /embed-text"
```

---

## Task 5: Rewire `/api/search` to the LLM-described pipeline

**Files:**
- Modify: `backend/src/routes/search.ts`

- [ ] **Step 1: Replace contents**

Replace the whole file with:

```ts
import { Router } from 'express'
import multer from 'multer'
import { getTextEmbedding } from '../services/clipService'
import { searchSimilar } from '../services/chromaService'
import { describeRoomForDoorMatching } from '../services/geminiService'

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

    const description = await describeRoomForDoorMatching(req.file.buffer, req.file.mimetype)
    console.log(`[SEARCH] Gemini description: "${description}"`)

    const embedding = await getTextEmbedding(description)
    const { results, isLowSimilarity } = await searchSimilar(embedding, 10)

    if (results.length === 0) {
      res.json({ products: [], description, status: 'empty-catalog' })
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
      description,
      status: isLowSimilarity ? 'low-similarity' : 'success',
    })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 2: Type-check**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/search.ts
git commit -m "feat(backend): rewire /api/search to image→Gemini→CLIP-text→ChromaDB"
```

---

## Task 6: Surface the description in the UI

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/SearchResults.tsx`

- [ ] **Step 1: Find the `SearchResult` type and add `description`**

Open `frontend/src/types/index.ts`, locate the `SearchResult` interface, and add `description: string` to it. (Keep all existing fields.)

```ts
// inside SearchResult interface, alongside existing fields:
description: string
```

- [ ] **Step 2: Render the description in `SearchResults.tsx`**

Open `frontend/src/components/SearchResults.tsx`. Just above the results grid (when status is `success` or `low-similarity`), add:

```tsx
{searchResult?.description && (
  <p className="mb-4 text-center text-sm text-gray-500">
    Searching for: <span className="italic text-gray-700">"{searchResult.description}"</span>
  </p>
)}
```

If the file already has a wrapper around the grid, place this inside that wrapper above the grid component. Adjust class names to match the existing design system (Tailwind v3 utilities).

- [ ] **Step 3: Type-check frontend**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/components/SearchResults.tsx
git commit -m "feat(frontend): surface AI-generated query description above results"
```

---

## Task 7: End-to-end smoke test

**Files:** none — manual verification only.

- [ ] **Step 1: Make sure all four services are running**

Per `CLAUDE.md`:
- Terminal 1: `chroma run --path ./chroma_db --port 8000`
- Terminal 2: `uvicorn main:app --port 8001` (sidecar — restarted with new endpoint)
- Terminal 3: `npm run dev` (backend — restarted to pick up `.env`)
- Terminal 4: `npm run dev` (frontend)

- [ ] **Step 2: Sidecar text endpoint sanity check**

```bash
curl -X POST http://localhost:8001/embed-text -H "Content-Type: application/json" -d "{\"text\": \"a white modern matte interior door\"}"
```

Expected: 512-dim float array.

- [ ] **Step 3: Upload three visually distinct interior photos in the UI**

Test images (any three you have, but they should be clearly different):
1. A modern white minimalist room
2. A rustic / wooden / classic-style room
3. A dark or industrial-style room

For each: open `http://localhost:5173`, drop the photo, observe:
- The "Searching for: ..." caption above the results — should be different per photo
- The top-10 product cards — should differ between photos

- [ ] **Step 4: Backend log inspection**

In the backend terminal, you should see three distinct log lines like:

```
[SEARCH] Gemini description: "white modern flat panel matte interior door"
[SEARCH] Gemini description: "dark oak classic raised panel wooden door"
[SEARCH] Gemini description: "industrial dark grey minimalist interior door"
```

- [ ] **Step 5: If results are still identical**

Check, in order:
1. Is `GEMINI_API_KEY` actually loaded? (`console.log(process.env.GEMINI_API_KEY?.slice(0,4))` early in `index.ts`)
2. Does the description differ across photos in the backend log?
3. If descriptions differ but results are still the same → the problem is at the CLIP-text/ChromaDB layer; log a few values of the embedding for each query to confirm they differ.

- [ ] **Step 6: Final commit if any tweaks made during testing**

```bash
git add -u
git commit -m "fix: smoke-test adjustments"
```
