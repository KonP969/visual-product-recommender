"""Eksploracja: rozkład wariantów kolorów i wskaźników przeszklenia w katalogu."""
import re
from collections import Counter
import chromadb

client = chromadb.HttpClient(host="localhost", port=8000)
col = client.get_collection("products")

variants = Counter()
no_variant_colors = Counter()
glass_name = 0
glass_desc_only = 0
no_glass = 0
total = 0

GLASS_NAME_RE = re.compile(r"szyb|bulaj|przeszkl|witryn|glass|szpros", re.I)
GLASS_DESC_RE = re.compile(r"glass|frosted|glazed", re.I)

offset = 0
samples_glass_desc_only = []
while True:
    r = col.get(limit=500, offset=offset, include=["metadatas"])
    if not r["ids"]:
        break
    for meta in r["metadatas"]:
        total += 1
        name = meta.get("name", "")
        desc = meta.get("description", "") or ""
        parts = name.split(" - ")
        if len(parts) > 1 and parts[1].strip():
            variants[parts[1].strip()] += 1
        else:
            # brak wariantu — pierwszy kolor z opisu EN
            m = re.match(r"([a-z ]{3,30}?)(?:tinted|frosted|residential|interior|acoustic|security|steel|glass|door)", desc)
            no_variant_colors[(m.group(1).strip() if m else "???")[:40]] += 1
        if GLASS_NAME_RE.search(name):
            glass_name += 1
        elif GLASS_DESC_RE.search(desc):
            glass_desc_only += 1
            if len(samples_glass_desc_only) < 10:
                samples_glass_desc_only.append(name[:70])
        else:
            no_glass += 1
    offset += len(r["ids"])

print(f"TOTAL: {total}")
print(f"\nGLASS: w nazwie={glass_name}, tylko w opisie={glass_desc_only}, brak={no_glass}")
print("\nPrzykłady 'glass tylko w opisie':")
for s in samples_glass_desc_only:
    print("  ", s)
print(f"\nWARIANTY ({len(variants)} unikalnych), top 60:")
for v, c in variants.most_common(60):
    print(f"  {c:4d}  {v}")
print(f"\nBEZ WARIANTU ({sum(no_variant_colors.values())}), kolory z opisu top 30:")
for v, c in no_variant_colors.most_common(30):
    print(f"  {c:4d}  {v}")
