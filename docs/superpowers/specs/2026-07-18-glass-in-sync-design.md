# Wizyjne wykrywanie szkła w ścieżce importu

Data: 2026-07-18
Gałąź: `feat/glass-in-sync` · Baza: `master` @ 5ccb307

## Problem

`has_glass` dla nowo importowanych produktów jest liczone z samej NAZWY/opisu
(`classifyDoor(name, desc)` → `GLASS_RE.test(...)`). Modele przeszklone, których
nazwa nie mówi o szkle (np. `PORTA CLASSIC HOME model C.2`), lądują błędnie jako
`has_glass=false`. To ten sam root-cause, który naprawił jednorazowy backfill
(`backfillGlass.ts`, commit f10bd82) — ale backfill działa na istniejących
danych, a **import wciąż klasyfikuje tekstowo**, więc bug wraca dla każdego
nowego produktu przy następnym sync/imporcie.

Bug jest w DWÓCH ścieżkach: `syncCatalog.ts:104` (sync z feedu) i
`importService.ts:65` (import z UI). Obie wołają `classifyDoor`.

## Decyzje (ustalone z użytkownikiem)

1. **Podejście:** krok wizji PO imporcie — wspólna funkcja `resolveGlassForProducts`
   wołana automatycznie na końcu `syncCatalog` oraz importu z UI. Jedna poprawka
   łata obie ścieżki (nie inline w pętli, nie ręczny skrypt).
2. **Zasięg:** tylko nowo dodane produkty (lista ID), nie cały katalog. Import
   5 sztuk = co najwyżej kilka wywołań wizji.
3. **Fallback (decyzja implementacyjna):** import zapisuje `has_glass` tekstowo
   jak dziś; `resolveGlass` tylko KORYGUJE. Pad wizji → brak korekty → zostaje
   wartość tekstowa (najgorszy przypadek = dzisiejsze zachowanie, import nigdy
   się nie wysypie ani nie zostawi `null`).
4. **Reuse przez Chromę:** źródłem prawdy dla istniejących modeli jest baza
   (rodzeństwo modelu), nie gitignore'owany `backfill_glass_progress.json`.

## Architektura

Nowy plik `backend/src/services/glassResolver.ts` — wspólny rdzeń wyciągnięty
z `backfillGlass.ts`, obsługujący oba wywołania importu ORAZ standalone backfill.

```ts
export interface NowyProdukt { id: string; name: string; imageUrl: string }
export interface WynikResolve { visionCalls: number; flips: number; failed: number }

export async function resolveGlassForProducts(
  col: Collection,
  nowe: NowyProdukt[],
): Promise<WynikResolve>
```

Wydzielone czyste helpery (testowalne bez sieci):
- `modelOf(name: string): string` — `name.split(' - ')[0].trim()` (przeniesione z backfillu).
- `decideGlassFromName(names: string[]): boolean | null` — precedencja z nazw:
  dowolna pasuje `GLASS_RE` → `true`; dowolna `SOLID_NAME_RE` → `false`; inaczej `null`.

Współdzielone z wizją: `visionDecision(imageUrl)` (przeniesione z backfillu).

### Algorytm `resolveGlassForProducts`

Dla listy właśnie dodanych produktów:
1. Odfiltruj do `residential` (`categorizeDoor`), zgrupuj po modelu (`modelOf`).
2. Dla każdego modelu rozstrzygnij szkło, w tej kolejności:
   a. `decideGlassFromName` na nazwach wariantów → jeśli nie `null`, użyj.
   b. inaczej: sprawdź, czy model ma WCZEŚNIEJSZE warianty (spoza listy `nowe`)
      z ustalonym `has_glass` → reuse tej wartości (zero wizji). Chroma nie ma
      pola „model" (filtruje po metadanych, nie po prefiksie nazwy), więc reuse
      opiera się na JEDNYM odczycie `(name, has_glass)` całej kolekcji na starcie
      `resolveGlassForProducts` → mapa `model → has_glass` z istniejących rekordów.
   c. inaczej: 1 wizja na reprezentatywnym zdjęciu (`classifyGlassFromImage`,
      współbieżność 3). Pad wizji → pomiń model (brak korekty).
3. Zastosuj decyzję: `col.update` na nowych rekordach, gdzie `has_glass` się różni.

Zwraca `{ visionCalls, flips, failed }` do logu.

### Refaktor `backfillGlass.ts`

Przełączyć na wspólne helpery (`modelOf`, `decideGlassFromName`, `visionDecision`)
z `glassResolver.ts` — bez duplikacji. Zachowuje swoje zachowanie: cały katalog,
plik postępu `backfill_glass_progress.json`, wznawialność.

## Wpięcie

- `syncCatalog.ts`: po pętli batchy (krok 3) zebrać listę faktycznie dodanych
  `{id, name, imageUrl}` i wywołać `resolveGlassForProducts(col, dodane)`.
  Zalogować wynik.
- `importService.ts`: analogicznie, po pętli importu, na produktach które przeszły
  (`success`). Wywołać i zalogować.

## Testy

- **Jednostkowe (vitest, czysta logika):** `decideGlassFromName` — precedencja
  (`['… z szybą - Biały'] → true`, `['… pełne - Biały'] → false`,
  `['PORTA CLASSIC HOME model C.2 - Szary'] → null`); `modelOf` — wyciąga model
  z nazwy z wariantem i bez.
- **E2e reuse bez kosztu Gemini:** skonstruować syntetyczny „nowy wariant"
  istniejącego modelu-ze-szkłem (nowe id, ta sama nazwa modelu) + drugi dla modelu
  pełnego; przepuścić przez `resolveGlassForProducts` na żywej Chromie; sprawdzić
  `has_glass` poprawne ORAZ `visionCalls === 0` (reuse zadziałał); posprzątać
  syntetyczne id.
- **E2e wizja (1 model):** jeden faktycznie cichy model przez wizję — spot-check,
  że decyzja sensowna.
- **Regresja:** backend `vitest` (82+) i `tsc` czyste; `backfillGlass.ts` nadal
  działa po refaktorze (dry-run/spot-check bez pełnego przebiegu).

## Poza zakresem

- Front nietknięty.
- `classifyDoor` bez zmian (tekstowy `has_glass` zostaje jako pierwszy zapis + fallback).
- Bez ponownego przetwarzania całego katalogu.
- Kolor/opis bez zmian — wyłącznie `has_glass`.

## Definicja ukończenia

Testy jednostkowe zielone, backend 82+ zielony, `tsc` czysty, e2e reuse
potwierdza `visionCalls===0` + poprawne `has_glass`, e2e wizja sensowna,
`backfillGlass` działa po refaktorze. Punkt powrotu: `master` @ 5ccb307.
