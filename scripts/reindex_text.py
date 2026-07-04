"""
Reindex all products in ChromaDB: replace embeddings with CLIP text embeddings
of Gemini-generated, richer English descriptions (color + category + room context).

Pipeline per batch (50 products):
  Polish names  ->  Gemini 2.5-flash-lite  ->  English descriptions (25-35 words)
                                            \\-> sidecar /embed-text -> 512-D vectors
                                            \\-> ChromaDB upsert (replaces existing)

Usage:
  python reindex_text.py           # resume from last saved progress
  python reindex_text.py --full    # re-index ALL products (overwrites existing descriptions)

Quota: gemini-2.5-flash-lite = 1000 RPD, 30 RPM.
  4907 products / 50 per batch = 99 batches → fits comfortably in one day.
  Estimated time: ~60-90 min with CONCURRENCY=2.
  Resumable if quota runs out mid-way.
"""
import argparse
import json
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests
import chromadb

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / "backend" / ".env"
PROGRESS_FILE = ROOT / "scripts" / "reindex_progress.json"

SIDECAR = "http://localhost:8001"
GEMINI_MODEL = "gemini-2.5-flash-lite"  # 1000 RPD, 30 RPM — higher quota than flash (250 RPD)
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

BATCH_SIZE = 50
CONCURRENCY = 1  # sequential — avoids burning quota on parallel 429 cascades
PROGRESS_LOCK = threading.Lock()

PROMPT_TEMPLATE = """You are processing a Polish catalog of doors. For each numbered Polish product name, output an English description optimized for CLIP image-search.

INPUT FORMAT: each line is "<index>. <Polish name>"

OUTPUT FORMAT: a JSON array of objects, one per input line, with keys "i" (index as int) and "d" (English description). Output ONLY the JSON, no preamble, no markdown fences.

DESCRIPTION RULES:
- FIRST determine the PRODUCT CATEGORY from the name (see CATEGORY GUIDE below) and encode it in the description.
- Start with the DOMINANT DOOR COLOR in English (white, black, dark oak, light oak, walnut, grey, anthracite, beige, champagne, frosted glass, transparent glass, graphite, etc.)
- Repeat the color or a tonal synonym at least once more in the description.
- Include material clue (wood / wood veneer / lacquered / powder-coated steel / glass) and style cue (flat panel / raised panel / glass insert / loft / classic / modern).
- Add room context for residential doors: where it fits (bedroom, living room, hallway, home office) and mood (cozy, minimalist, warm, elegant, rustic).
- Target 25–35 words. Stay within 60 words. CLIP-friendly: plain nouns and adjectives, no verbs or sentences.

CATEGORY GUIDE (apply the category keyword to the description):
- Residential interior door (HOME, SYSTEM, VERTE, GLASS, CLASSIC, LOFT, VECTOR, FIT, LIFE, standard model names without special suffixes) → include "residential interior door" in description
- Acoustic / sound-insulation door (Akustyczne, akustyczna, dB) → include "acoustic sound insulation door" in description
- Security / anti-burglary door (EXTREME, RC2, RC3, RC4, antywłamaniowe) → include "security reinforced entrance door" in description
- Steel / technical door (Steel SOLID, stalowe techniczne, GRANIT) → include "steel technical entrance door" in description
- Fire-rated door (EI, przeciwpożarowe) → include "fire rated door" in description

POLISH VOCABULARY GUIDE:
- Biały = white, Czarny = black, Szary = grey, Antracyt = anthracite, Szampański = champagne
- Dąb = oak, Brunatny = brown, Ciemny = dark, Jasny = light, Lakeland = beige oak
- Wenge = wenge dark, Akacja = acacia, Brzoza = birch
- Szyba = glass pane, matowa = frosted, przezroczysta = transparent, ryflowana = ribbed, grafitowa = graphite tinted
- Farba proszkowana = powder-coated steel
- Struktura = textured finish
- przylgowa/bezprzylgowa = rebated/flush, intarsja = inlay
- Akustyczne / dB = acoustic sound insulation
- EXTREME RC / antywłamaniowe = security anti-burglary reinforced
- Steel SOLID / GRANIT = steel technical or security entrance

EXAMPLES:
INPUT:
1. PORTA CLASSIC HOME model B.1 - Biały
2. PORTA VERTE HOME model G.1 z czarną szybą - Dąb Arles Ciemny
3. PORTA LOFT model 6 - Farba proszkowana - Czarny Struktura
4. PORTA GLASS szyba matowa - Szyba matowa
5. PORTA Akustyczne 42 dB model 1 - Biały
6. PORTA EXTREME RC3 model - Antracyt
7. Steel SOLID model 3 - Antracyt

OUTPUT:
[{"i":1,"d":"white bright matte flat panel modern minimalist residential interior door white clean bedroom hallway home elegant"},{"i":2,"d":"dark oak wood grain modern glass insert residential interior door dark brown warm living room home elegant"},{"i":3,"d":"black powder-coated textured loft modern flat panel residential interior door black dark matte home bedroom industrial style"},{"i":4,"d":"frosted glass white translucent matte minimalist residential interior glass door white bright modern home living room"},{"i":5,"d":"white acoustic sound insulation speciality door matte flat panel white noise reduction technical residential"},{"i":6,"d":"anthracite security reinforced entrance anti-burglary door dark grey RC3 armoured exterior anthracite"},{"i":7,"d":"anthracite steel technical entrance door dark grey flat panel exterior security anthracite heavy duty"}]

NOW PROCESS THE FOLLOWING (output ONLY the JSON array):
"""


def load_api_key() -> str:
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("GEMINI_API_KEY not found in backend/.env")


def call_gemini(api_key: str, names_block: str) -> list[dict]:
    body = {
        "contents": [{"parts": [{"text": PROMPT_TEMPLATE + names_block}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    for attempt in range(8):
        try:
            r = requests.post(f"{GEMINI_URL}?key={api_key}", json=body, timeout=180)
            if r.status_code == 429:
                wait = 20 * (attempt + 1)
                print(f"  429, sleeping {wait}s...", flush=True)
                time.sleep(wait)
                continue
            r.raise_for_status()
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except Exception as e:
            print(f"  attempt {attempt+1} failed: {e}", flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("Gemini failed after 8 attempts")


def embed_text(text: str) -> list[float]:
    r = requests.post(f"{SIDECAR}/embed-text", json={"text": text}, timeout=30)
    r.raise_for_status()
    return r.json()["embedding"]


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"done_ids": []}


def save_progress(state: dict) -> None:
    PROGRESS_FILE.write_text(json.dumps(state))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reindex product embeddings via Gemini text descriptions")
    parser.add_argument("--full", action="store_true", help="Re-index ALL products, ignoring saved progress")
    args = parser.parse_args()

    api_key = load_api_key()
    client = chromadb.HttpClient(host="localhost", port=8000)
    col = client.get_or_create_collection("products")
    total = col.count()
    print(f"Collection 'products': {total} items", flush=True)

    if args.full:
        state = {"done_ids": []}
        save_progress(state)
        print("--full: cleared progress, re-indexing all products", flush=True)
    else:
        state = load_progress()
    done = set(state["done_ids"])
    print(f"Resuming, {len(done)} already reindexed", flush=True)

    all_data = col.get(include=["metadatas"])
    todo = [
        (pid, m["name"])
        for pid, m in zip(all_data["ids"], all_data["metadatas"])
        if pid not in done
    ]
    print(f"Remaining to process: {len(todo)}", flush=True)

    meta_by_id = dict(zip(all_data["ids"], all_data["metadatas"]))
    total_batches = (len(todo) + BATCH_SIZE - 1) // BATCH_SIZE

    def process_batch(batch_idx: int, batch: list[tuple[str, str]]) -> tuple[int, str]:
        names_block = "\n".join(f"{i+1}. {name}" for i, (_, name) in enumerate(batch))
        t0 = time.time()
        try:
            results = call_gemini(api_key, names_block)
        except Exception as e:
            return batch_idx, f"FAILED gemini: {e}"

        by_idx = {int(r["i"]): r["d"] for r in results if "i" in r and "d" in r}
        new_ids, new_embeddings, new_metadatas = [], [], []
        sample_desc = ""
        for i, (pid, _name) in enumerate(batch, start=1):
            desc = by_idx.get(i)
            if not desc:
                continue
            try:
                emb = embed_text(desc)
            except Exception:
                continue
            new_ids.append(pid)
            new_embeddings.append(emb)
            new_meta = dict(meta_by_id[pid])
            new_meta["description"] = desc
            new_metadatas.append(new_meta)
            if not sample_desc:
                sample_desc = desc

        if new_ids:
            col.upsert(ids=new_ids, embeddings=new_embeddings, metadatas=new_metadatas)
            with PROGRESS_LOCK:
                done.update(new_ids)
                state["done_ids"] = list(done)
                save_progress(state)

        elapsed = time.time() - t0
        return batch_idx, (
            f"{len(new_ids)}/{len(batch)} ok in {elapsed:.1f}s. Sample: {sample_desc or 'n/a'}"
        )

    batches = [
        (b, todo[b * BATCH_SIZE : (b + 1) * BATCH_SIZE]) for b in range(total_batches)
    ]

    quota_exhausted = False
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futures = {ex.submit(process_batch, bi, b): bi for bi, b in batches}
        for f in as_completed(futures):
            bi, msg = f.result()
            print(f"Batch {bi+1}/{total_batches}: {msg}", flush=True)
            if msg.startswith("FAILED gemini"):
                print("\nQuota exhausted — stopping early. Progress saved.", flush=True)
                print(f"Run again tomorrow (without --full) to continue from batch {bi+1}.", flush=True)
                quota_exhausted = True
                # cancel remaining pending futures
                for pending in futures:
                    pending.cancel()
                break

    reindexed = len(done)
    remaining = total - reindexed
    print(f"\n{'Done' if not quota_exhausted else 'Stopped'}. Reindexed: {reindexed}/{total} ({reindexed/total*100:.1f}%). Remaining: {remaining}.", flush=True)


if __name__ == "__main__":
    main()
