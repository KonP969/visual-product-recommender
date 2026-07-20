# Zwijanie wariantów w wynikach (dedup po nazwie)

Data: 2026-07-20
Gałąź: `feat/dedupe-variants` · Baza: `master` @ 8741df8

## Problem

Ten sam model+kolor bywa w katalogu wiele razy (735 nadmiarowych rekordów w 704
grupach) — RÓŻNE ceny (642/704 grup), często różne obrazy (699/704). To NIE
duplikaty do skasowania: różnica jest realna (linia Premium/Plus/SBI, wymiar,
opcja), ale feed nie wystawia jej jako pola — siedzi w nazwie pliku obrazu
(niespójnie) albo tylko w cenie/`colorId`. Prawdziwych bliźniaków (nazwa+obraz
identyczne) jest tylko 7.

Skutek dla klienta: „PORTA HIDE 1.1 Biały" potrafi pojawić się 4× w siatce 10
wyników — wygląda jak powtórka, zjada różnorodność.

## Decyzja (ustalona z użytkownikiem)

Zwijać w PREZENTACJI, nie kasować danych: w siatce jedna karta na nazwę,
z ceną „od X zł" i linkiem do konfiguratora (gdzie klient wybiera wariant).
Dane w Chromie nietknięte.

## Architektura

Zwijanie w pipeline wyszukiwania, między rankingiem a MMR — na kandydatach
(z embeddingami), więc MMR dalej dywersyfikuje unikatowe nazwy.

### `chromaService.ts`

- `SearchResultItem` zyskuje `variantCount?: number` i `priceFrom?: string`.
- Nowa czysta funkcja:
  ```ts
  export function dedupeByName(candidates: CandidateItem[]): CandidateItem[]
  ```
  Grupuje po DOKŁADNEJ `metadata.name`. Zostawia PIERWSZY (najlepiej dopasowany —
  kandydaci są już posortowani) jako reprezentanta, z zachowaniem embeddingu.
  Na reprezentancie ustawia `variantCount` (liczność grupy w puli) i `priceFrom`
  (string ceny najtańszego wariantu w grupie). Kolejność wyniku = kolejność
  rankingu (pierwsze wystąpienie).
- W `searchSimilar`, między jitterem a MMR:
  ```ts
  const ranked = seed ? applySeededJitter(candidates, seed) : candidates
  const deduped = dedupeByName(ranked)
  const results = applyMMR(deduped, n)
  ```
- `applyMMR` — końcowe `map` zmienić z odtwarzania `{id, similarity, metadata}`
  na odcięcie WYŁĄCZNIE `embedding` (spread reszty), żeby `variantCount`/`priceFrom`
  przetrwały:
  ```ts
  return selected.map(({ embedding, ...rest }) => rest)
  ```

Min-cena liczona z PULI kandydatów (nie całego katalogu). Warianty tej samej
nazwy mają niemal identyczny embedding → rankują obok siebie → praktycznie zawsze
są razem w puli 50. Wystarczająco dokładne.

Singleton: `variantCount=1`, `priceFrom` = własna cena. Front używa `priceFrom`
jednolicie (karta i tak zawsze pokazuje „od").

### `routes/search.ts`

`toProducts` mapuje nowe pola: `priceFrom: r.priceFrom`, `variantCount: r.variantCount`.

### Frontend

- `types/index.ts` — `Product` zyskuje `priceFrom?: string`, `variantCount?: number`.
- `ProductCard.tsx` — kwota z `priceFrom ?? price` (karta już renderuje „od").
  Gdy `variantCount > 1` → dyskretny znacznik „{variantCount} wariantów".

## Testy

- **Jednostkowe `dedupeByName`:** identyczne nazwy → jeden rekord (reprezentant =
  pierwszy/najlepszy), `variantCount` = liczność, `priceFrom` = min cena grupy;
  różne nazwy → wszystkie zostają; „bezprzylgowe" (inna nazwa) NIE zwija się z
  bazowym; kolejność zachowana.
- **`applyMMR`:** dotychczasowe testy zielone (zmiana końcowego map nie psuje
  strip-embedding); dochodzi test, że `variantCount`/`priceFrom` przechodzą przez MMR.
- **E2e:** zapytanie łapiące grupę dup (np. „drzwi ukryte białe" / HIDE) → w siatce
  ZERO powtórzonych nazw; karta z >1 wariantem pokazuje „od {min}" i licznik.

## Poza zakresem

- Kasowanie/scalanie rekordów w Chromie (dane zostają).
- Wydobywanie linii Premium/Plus/SBI z nazwy pliku (kruche, niespójne — odrzucone).
- Dokładna min-cena z całego katalogu (pula wystarcza).

## Definicja ukończenia

Testy jednostkowe zielone; backend vitest (108+) i front (21+) zielone; typecheck
i build czyste; e2e: zapytanie na grupę dup zwraca unikatowe nazwy w siatce, karta
multi-wariant pokazuje „od {min} zł" + licznik. Punkt powrotu: `master` @ 8741df8.
