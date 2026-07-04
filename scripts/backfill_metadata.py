"""
Backfill `category` ('residential' | 'specialty') and `currency` ('PLN')
metadata on every product in ChromaDB, derived locally from the product name
(same patterns as backend/src/services/chromaService.ts — no Gemini calls).

Usage:  python backfill_metadata.py
Requires ChromaDB running on localhost:8000.
"""
import re
import chromadb

COMMERCIAL_DOOR_PATTERNS = [
    re.compile(r"akustyczn", re.I),
    re.compile(r"\d{2,}\s*db", re.I),
    re.compile(r"\brc\s*[2-6]\b", re.I),
    re.compile(r"steel\s+solid", re.I),
    re.compile(r"granit\s*c\b", re.I),
    re.compile(r"extreme\s*rc", re.I),
    re.compile(r"przeciwpoż", re.I),
]


def categorize(name: str) -> str:
    return "specialty" if any(p.search(name) for p in COMMERCIAL_DOOR_PATTERNS) else "residential"


def main() -> None:
    client = chromadb.HttpClient(host="localhost", port=8000)
    col = client.get_collection("products")
    total = col.count()
    print(f"Products in collection: {total}")

    BATCH = 200
    offset = 0
    updated = 0
    specialty = 0

    while True:
        result = col.get(limit=BATCH, offset=offset, include=["metadatas"])
        ids = result["ids"]
        if not ids:
            break

        new_metadatas = []
        for meta in result["metadatas"]:
            meta = dict(meta)
            meta["category"] = categorize(meta.get("name", ""))
            meta["currency"] = "PLN"
            if meta["category"] == "specialty":
                specialty += 1
            new_metadatas.append(meta)

        col.update(ids=ids, metadatas=new_metadatas)
        updated += len(ids)
        offset += len(ids)
        print(f"  updated {updated}/{total}", end="\r")
        if len(ids) < BATCH:
            break

    print(f"\nDone. Updated: {updated}, specialty: {specialty}, residential: {updated - specialty}")


if __name__ == "__main__":
    main()
