"""
Verify the new pipeline: CLIP text embedding -> ChromaDB query -> distinct products.

Bypasses Gemini and the backend. Uses three hardcoded English door descriptions
that simulate what Gemini would produce for three very different room photos.
If the top-10 differs across queries, the new pipeline works end-to-end.
"""
import requests
import chromadb

SIDECAR = "http://localhost:8001"
CHROMA_HOST, CHROMA_PORT = "localhost", 8000

QUERIES = [
    "white modern flat panel matte interior door",
    "dark walnut classic raised panel wooden door",
    "industrial black steel frame glass interior door",
]


def text_embed(text: str) -> list[float]:
    r = requests.post(f"{SIDECAR}/embed-text", json={"text": text}, timeout=30)
    r.raise_for_status()
    return r.json()["embedding"]


def main() -> None:
    client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    col = client.get_or_create_collection("products")
    total = col.count()
    print(f"ChromaDB collection 'products': {total} items\n")

    if total == 0:
        print("Collection is empty — import a feed first.")
        return

    top_ids_per_query = []
    top_names_per_query = []

    for q in QUERIES:
        emb = text_embed(q)
        res = col.query(query_embeddings=[emb], n_results=min(10, total))
        ids = res["ids"][0]
        metas = res["metadatas"][0]
        dists = res["distances"][0]

        top_ids_per_query.append(set(ids))
        top_names_per_query.append([m.get("name", "?") for m in metas])

        print(f'Query: "{q}"')
        for i, (mid, m, d) in enumerate(zip(ids, metas, dists), 1):
            print(f"  {i:2}. d={d:.4f}  {m.get('name','?')[:80]}")
        print()

    overlap_12 = top_ids_per_query[0] & top_ids_per_query[1]
    overlap_13 = top_ids_per_query[0] & top_ids_per_query[2]
    overlap_23 = top_ids_per_query[1] & top_ids_per_query[2]
    print("=== Overlap between top-10 sets ===")
    print(f"Q1 & Q2: {len(overlap_12)} / 10")
    print(f"Q1 & Q3: {len(overlap_13)} / 10")
    print(f"Q2 & Q3: {len(overlap_23)} / 10")

    avg_overlap = (len(overlap_12) + len(overlap_13) + len(overlap_23)) / 3
    print(f"\nAverage overlap: {avg_overlap:.1f} / 10")
    if avg_overlap >= 9:
        print("VERDICT: FAIL - Pipeline still returns essentially the same products.")
    elif avg_overlap >= 6:
        print("VERDICT: WEAK - Some differentiation but heavy overlap.")
    else:
        print("VERDICT: PASS - Different queries return meaningfully different products.")


if __name__ == "__main__":
    main()
