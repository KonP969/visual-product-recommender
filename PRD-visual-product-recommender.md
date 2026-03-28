# Visual Product Recommender — Product Requirements Document

<PRD>

## 1. Introduction

This document defines the product requirements for **Visual Product Recommender** — an MVP web application that allows users to upload a photo (e.g., an interior design, outfit, or any visual scene) and receive a curated list of visually similar products from a pre-loaded product catalog. The purpose of this PRD is to serve as a comprehensive specification that an AI coding tool or a single project owner can use to scope, plan, and build the application end-to-end.

---

## 2. Product overview

- **Product name:** Visual Product Recommender
- **One-sentence description:** Upload any photo and instantly get matched products from a catalog based on visual similarity, powered by CLIP embeddings and vector search.
- **Problem solved:** Users often see products in real-life contexts (magazines, social media, interiors) but cannot describe them with keywords precise enough to find matching items in an online catalog. This app bridges the gap between visual inspiration and product discovery.
- **MVP scope:** Hardcorowe MVP — upload an image, get visually similar products. No auth, no history, no filtering, no social features.

---

## 3. Goals and objectives

| Goal | Metric |
|------|--------|
| Prove the concept of visual product search works with CLIP + ChromaDB | Demo produces relevant top-5 results for test images |
| Keep the codebase clean enough to hand to someone else | Clear structure, modern UI, documented architecture |
| Keep the stack local-first and zero-cost | No cloud billing required to run the app locally |
| Design for extensibility | Architecture allows swapping CLIP → Vertex AI and ChromaDB → BigQuery VECTOR_SEARCH without rewriting the app |

---

## 4. Target audience

- **Primary (MVP):** The project owner, validating that the concept holds up end to end.
- **Secondary (post-MVP):** B2C end users — shoppers who want to find products matching a visual they've seen (interior design photo, outfit, street style, etc.).

---

## 5. Features and requirements

### 5.1 Core features (MVP)

| ID | Feature | Description |
|----|---------|-------------|
| F-01 | Image upload | Drag & drop or file picker. Accepts JPG, PNG, WEBP. Max 10 MB. |
| F-02 | Image embedding | Generate a CLIP vector embedding from the uploaded image via a Python sidecar or HuggingFace Inference API. |
| F-03 | Vector search | Query ChromaDB for the top N (default: 5–10) nearest product embeddings. |
| F-04 | Results display | Show matched products in an elegant grid: product image, name, price. |
| F-05 | XML feed import | Parse an XML product feed (Google Merchant / Ceneo format), extract product data (name, image URL, price, link), download images, generate embeddings, and store in ChromaDB. |
| F-06 | Product detail card | Each result card shows: product thumbnail, product name, price. Clicking opens the product source URL in a new tab (if available in feed). |

### 5.2 Non-functional requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NF-01 | Search latency | < 2 seconds from upload to results on local machine |
| NF-02 | Catalog size | Support up to 10,000 products in ChromaDB |
| NF-03 | Responsive design | Usable on desktop and tablet viewports |
| NF-04 | No external auth/billing | Runs fully locally without cloud accounts |

---

## 6. User stories and acceptance criteria

### Primary flow

**ST-101 — Upload a photo and receive product recommendations**
- *As a* user, *I want to* upload a photo of a scene or product *so that* I receive a list of visually similar products from the catalog.
- **Acceptance criteria:**
  - User can drag & drop or click to select an image file (JPG, PNG, WEBP, ≤ 10 MB).
  - Upload area shows a preview of the selected image.
  - Within 2 seconds, the app displays 5–10 product cards ranked by visual similarity.
  - Each card shows: product image, product name, price.
  - If the feed contains a product URL, clicking the card opens it in a new tab.

**ST-102 — Upload a new photo to replace previous results**
- *As a* user, *I want to* upload a different photo *so that* the results refresh with new matches.
- **Acceptance criteria:**
  - Uploading a new image clears previous results.
  - New results appear within 2 seconds.
  - The new image preview replaces the old one.

### Catalog management

**ST-201 — Import a product catalog from an XML feed**
- *As a* project owner, *I want to* import products from an XML feed file *so that* the vector database is populated with product embeddings.
- **Acceptance criteria:**
  - A CLI command or script accepts a path to an XML feed file.
  - The script parses product entries (name, image URL, price, product URL).
  - For each product, the script downloads the image, generates a CLIP embedding, and stores the embedding + metadata in ChromaDB.
  - The script logs progress (X/Y products processed) and reports errors for failed downloads.
  - After import, the products are immediately searchable via the web UI.

**ST-202 — Handle missing or broken image URLs in the feed**
- *As a* project owner, *I want* the import script to gracefully handle broken image URLs *so that* one bad entry doesn't crash the entire import.
- **Acceptance criteria:**
  - Products with unreachable image URLs are skipped with a warning logged.
  - The import continues processing remaining products.
  - A summary at the end shows: total processed, successful, failed.

### Edge cases

**ST-301 — Upload an unsupported file type**
- *As a* user, *I want to* see a clear error message if I upload a non-image file *so that* I know what formats are accepted.
- **Acceptance criteria:**
  - Non-image files (PDF, DOC, TXT, etc.) are rejected before upload.
  - The UI shows: "Please upload an image file (JPG, PNG, or WEBP)."

**ST-302 — Upload an image that exceeds the size limit**
- *As a* user, *I want to* see a clear error message if my image is too large *so that* I can resize and retry.
- **Acceptance criteria:**
  - Files > 10 MB are rejected with message: "Image must be under 10 MB."

**ST-303 — Search with an empty catalog**
- *As a* user, *I want to* see a helpful message if no products are loaded *so that* I understand the system needs a catalog first.
- **Acceptance criteria:**
  - If ChromaDB has 0 products, the UI shows: "No products in catalog. Import a product feed to get started."

**ST-304 — Search returns low-similarity results**
- *As a* user, *I want to* know when results may not be a great match *so that* I can adjust my expectations.
- **Acceptance criteria:**
  - If the top result's similarity score is below a threshold (e.g., < 0.3 cosine similarity), the UI shows a note: "We couldn't find a close match. Try a different photo."

**ST-305 — Handle server/embedding errors gracefully**
- *As a* user, *I want to* see a user-friendly error if something breaks *so that* I'm not stuck on a broken screen.
- **Acceptance criteria:**
  - If the embedding service or ChromaDB is unreachable, the UI shows: "Something went wrong. Please try again."
  - Errors are logged to the server console with full stack trace.

---

## 7. Technical requirements / stack

### Architecture overview

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                   │
│         shadcn/ui + TailwindCSS + Lucide Icons       │
│              React Hook Form (upload)                 │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────┐
│                Backend (Node.js / Express)            │
│         - POST /api/search (image upload)            │
│         - GET  /api/health                           │
│         - POST /api/import (trigger feed import)     │
└──────┬───────────────────────────────┬──────────────┘
       │                               │
┌──────▼──────────┐          ┌────────▼─────────────┐
│  Python Sidecar  │          │     ChromaDB          │
│  (CLIP model)    │          │  (vector storage +    │
│  FastAPI / Flask │          │   similarity search)  │
│  Port 8001       │          │   Port 8000           │
└─────────────────┘          └──────────────────────┘
```

### Stack details

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | React 18+ | Modern, component-based, huge ecosystem |
| **UI components** | shadcn/ui | Production-quality, accessible, customizable |
| **Styling** | TailwindCSS | Utility-first, rapid prototyping, clean output |
| **Icons** | Lucide Icons | Lightweight, consistent, works with shadcn |
| **Forms** | React Hook Form | Lightweight, performant form handling |
| **Backend** | Node.js + Express | Unified JS stack with frontend, simple REST API |
| **Embedding model** | CLIP (ViT-B/32) via Python sidecar | Free, open-source, no vendor lock-in, excellent visual similarity |
| **Python sidecar** | FastAPI | Lightweight, async, serves CLIP model |
| **Vector database** | ChromaDB | Open-source, local, zero cost, fast for MVP scale |
| **Feed parsing** | xml2js (Node.js) | Parse XML product feeds |
| **Image download** | axios / node-fetch | Download product images from feed URLs |
| **Build tool** | Vite | Fast dev server, optimized builds |

### Production path (post-MVP)

For scaling beyond MVP, the architecture supports swapping:
- **CLIP → Vertex AI Multimodal Embeddings** (`multimodalembedding@001`) for higher quality
- **ChromaDB → BigQuery VECTOR_SEARCH** (ML.SIMILARITY) for warehouse-scale catalogs
- **Local hosting → Cloud Run (backend) + Vercel (frontend)** for public deployment

### API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search` | Accepts multipart image upload, returns top N matched products |
| GET | `/api/health` | Health check for backend + ChromaDB + Python sidecar |
| POST | `/api/import` | Triggers XML feed import (accepts file path or URL) |
| GET | `/api/catalog/stats` | Returns product count and catalog status |

---

## 8. Design and user interface

### Design principles

- **Minimalist and clean** — Apple-inspired aesthetic with generous white space
- **Content-first** — the uploaded image and product results are the heroes
- **Zero clutter** — no sidebars, no unnecessary navigation, no distractions
- **Subtle depth** — light shadows, rounded corners, smooth transitions

### Design reference

- **UX pattern:** ASOS Style Match — upload → instant results grid
- **Visual style:** Apple product pages — white backgrounds, clean typography, spacious layout

### Layout

```
┌─────────────────────────────────────────────────────┐
│  ○ Visual Product Recommender            [GitHub ↗]  │  ← Minimal header
├─────────────────────────────────────────────────────┤
│                                                      │
│         ┌───────────────────────────┐               │
│         │                           │               │
│         │     Drop your image here  │               │  ← Large drop zone
│         │     or click to upload    │               │     (centered, prominent)
│         │         📷                │               │
│         └───────────────────────────┘               │
│                                                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Your photo:          Matching products:             │
│  ┌─────────┐         ┌─────┐ ┌─────┐ ┌─────┐       │
│  │         │         │     │ │     │ │     │       │  ← Results grid
│  │ preview │         │ P1  │ │ P2  │ │ P3  │       │     (product cards)
│  │         │         │ $99 │ │ $79 │ │$120 │       │
│  └─────────┘         └─────┘ └─────┘ └─────┘       │
│                       ┌─────┐ ┌─────┐               │
│                       │     │ │     │               │
│                       │ P4  │ │ P5  │               │
│                       │ $55 │ │ $89 │               │
│                       └─────┘ └─────┘               │
│                                                      │
├─────────────────────────────────────────────────────┤
│  Built with CLIP + ChromaDB              Konrad P.   │  ← Minimal footer
└─────────────────────────────────────────────────────┘
```

### Color palette

| Element | Color |
|---------|-------|
| Background | `#FFFFFF` (white) |
| Text primary | `#0A0A0A` (near-black) |
| Text secondary | `#6B7280` (gray-500) |
| Border / dividers | `#E5E7EB` (gray-200) |
| Accent / hover | `#3B82F6` (blue-500) |
| Drop zone background | `#F9FAFB` (gray-50) |
| Card shadow | `0 1px 3px rgba(0,0,0,0.1)` |

### Typography

- **Font:** Inter (system fallback: -apple-system, sans-serif)
- **Heading:** 24px semibold
- **Body:** 16px regular
- **Price:** 14px semibold
- **Caption:** 12px regular, gray-500

### Interactions

- Drag & drop highlights the drop zone with a blue dashed border
- Upload triggers a subtle loading spinner on the results area
- Product cards have a gentle scale-up on hover (transform: scale 1.02)
- Smooth fade-in animation when results appear

---

## 9. Future feature ideas (post-MVP roadmap)

| Priority | Feature | Description |
|----------|---------|-------------|
| High | **Result filtering** | Filter matched products by category, price range, or availability |
| High | **Mobile version / PWA** | Responsive mobile-first design, installable as PWA |
| Medium | "Find similar" drill-down | Click a result product to find more items similar to *that* product |
| Medium | Search history | Save and revisit previous searches |
| Medium | BigQuery integration | Swap ChromaDB for BigQuery VECTOR_SEARCH for production scale |
| Low | Auth + saved collections | User accounts with saved product boards/wishlists |
| Low | Multiple feed sources | Support multiple XML feeds / API integrations |
| Low | Admin panel | UI for feed management, catalog stats, re-indexing |

</PRD>

---

## Guardrails reminder

1. Unikaj Dockera — to prosta aplikacja dla jednego użytkownika na MVP.
2. Używaj najnowszych trendów w web designie: **TailwindCSS**, **Lucide Icons**, **React Hook Form**, **shadcn/ui**.
3. Cały dokument jest w formacie Markdown — gotowy do wklejenia do AI coding tool.
