# Visual Product Recommender — instrukcja uruchomienia

## Wymagania wstępne

- Node.js (ia32 / 32-bit — ta maszyna używa ia32)
- Python (Anaconda)
- ChromaDB zainstalowane: `pip install chromadb`

## Uruchomienie projektu — 4 terminale

### Terminal 1 — ChromaDB (baza wektorowa)

```bash
cd C:\Users\Konrad\Documents\__projects_and_git_repo_clones\Procuct_reco_base_on_img
chroma run --path ./chroma_db --port 8000
```

### Terminal 2 — Python sidecar (model CLIP)

```bash
cd C:\Users\Konrad\Documents\__projects_and_git_repo_clones\Procuct_reco_base_on_img\python-sidecar
venv\Scripts\activate
uvicorn main:app --port 8001
```

> Pierwsze uruchomienie ładuje model CLIP (~30 sekund). Kolejne są szybsze.

### Terminal 3 — Backend Express

```bash
cd C:\Users\Konrad\Documents\__projects_and_git_repo_clones\Procuct_reco_base_on_img\backend
npm run dev
```

### Terminal 4 — Frontend Vite

```bash
cd C:\Users\Konrad\Documents\__projects_and_git_repo_clones\Procuct_reco_base_on_img\frontend
npm run dev
```

## Adresy

| Serwis | Adres |
|--------|-------|
| Aplikacja (UI) | http://localhost:5173 |
| Backend API | http://localhost:3001 |
| Health check | http://localhost:3001/api/health |
| Python sidecar | http://localhost:8001 |
| ChromaDB | http://localhost:8000 |

## Ważne uwagi

- **Dane w ChromaDB są trwałe** — folder `chroma_db/` na dysku. Nie trzeba importować ponownie po restarcie.
- **Tailwind v3** — projekt używa Tailwind v3 (nie v4) ze względu na 32-bitowy Node.js (brak binarek lightningcss dla ia32).
- **Import feedu** — przez UI (panel "Import product catalog") lub curl:
  ```bash
  curl -X POST http://localhost:3001/api/import \
    -H "Content-Type: application/json" \
    -d "{\"feedUrl\": \"https://www.porta.com.pl/product-feed.xml\", \"limit\": 20}"
  ```
- **Skip duplikatów** — import pomija produkty już istniejące w ChromaDB (po `external_id`).

## Stack

| Warstwa | Technologia |
|---------|-------------|
| Frontend | React 18 + TypeScript + Vite + shadcn/ui + Tailwind v3 |
| Backend | Node.js + Express + TypeScript |
| Embeddingi | CLIP ViT-B/32 via FastAPI (Python) |
| Baza wektorowa | ChromaDB |
