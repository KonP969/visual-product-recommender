# Styl jako cecha modelu + wygaszanie chipów stylu bez trafień

Data: 2026-08-02
Gałąź: `master` · Punkt powrotu: `master` @ 5b6a4cd

## Problem

Filtr stylu (spec `2026-07-19-style-filter-design.md`) klasyfikuje **każdy wariant
osobno**, z jego własnego opisu. Opisy wariantów tego samego modelu różnią się —
część powstała z krótkiego szablonu, część z dłuższej parafrazy LLM — więc styl
przykleja się do wybarwienia zamiast do bryły drzwi:

```
PORTA FIT model H.2 - Dąb Catania      → "...modern residential interior door..."   rust=false
PORTA FIT model H.2 - Akacja Miodowa   → "...modern design, adding a rustic touch"  rust=true
```

Skutki zmierzone na katalogu (8130 residential, 580 modeli):

- **417 z 580 modeli ma styl niespójny** między wariantami — to reguła, nie wyjątek.
- Kliknięcie „rustykalne" zwraca jeden kolor modelu i gubi pozostałe.
- Przy pustym przekroju (białe × rustykalne = **0 rekordów**) warunek
  `$or [styl, style_none]` degeneruje do 7 białych bezstylowych, w tym
  `PORTA Steel EI 60 Plus` — stąd zgłoszenie „pokazuje drzwi stalowe".

## Decyzje (ustalone z użytkownikiem)

1. **Styl to cecha MODELU**, propagowana na wszystkie warianty kolorystyczne.
   Grupowanie po `modelOf` (nazwa przed `" - "`) — poziom modelu, nie kolekcji:
   w VECTORZE `model B` wychodzi klasyczny, a `model F` nowoczesny+rustykalny.
2. **Reguła agregacji: większość, inaczej lider.** Styl dostaje model, gdy
   potwierdza go >50% opisów wariantów; gdy żaden nie ma większości — wygrywa
   styl z największą liczbą głosów (remis → wszyscy liderzy). Bez arbitralnej stałej.
3. **Pusty przekrój → pominięcie filtra stylu z komunikatem**, nie ciche
   podstawienie drzwi bezstylowych. Ten sam wzorzec co `droppedFinish`.
4. **Liczniki chipów z indeksu w pamięci** backendu, dołączane do odpowiedzi
   wyszukiwania (`styleCounts`). Zmierzone: liczenie na żywo w Chromie kosztuje
   +330–375 ms na wyszukiwanie, indeks w pamięci — 71 ms.
5. **Chip bez trafień: przygaszony i nieklikalny, wszystkie chipy stylu z liczbą.**

### Dlaczego nie union i nie czysta większość

| styl | dziś (per wariant) | **większość\|lider** | próg 1/3 | czysta większość | union |
|---|---|---|---|---|---|
| klasyczny | 1710 | **786** | 1038 | 739 | 7160 |
| nowoczesny | 6298 | **7582** | 7579 | 6512 | 7933 |
| minimalistyczny | 1850 | **489** | 1524 | 388 | 7078 |
| rustykalny | 777 | **97** | 158 | 80 | 5641 |
| loft | 258 | **243** | 240 | 238 | 1350 |
| skandynawski | 112 | **3** | 18 | 1 | 1871 |
| glamour | 226 | **15** | 18 | 15 | 3522 |
| **bez stylu (wariantów)** | 425 | **26** | 136 | 1161 | 26 |

- **Union** („dowolny wariant mówi rustic") niszczy filtr: rustykalny obejmuje 69%
  katalogu, klasyczny 88%.
- **Czysta większość** wypycha 64 modele (1161 wariantów) do `style_none`, a tych
  nigdy nie chowamy — wyskakiwałyby pod KAŻDYM chipem. Ostrość obraca się
  przeciwko filtrowi.
- **Próg 1/3** wpuszcza szum przy modelach 3-wariantowych (jedna wzmianka = 33%):
  `NATURA VECTOR model B` dostawał rustykalny i skandynawski od pojedynczego opisu.
- **Większość|lider** daje 21 modeli rustykalnych — cała kolekcja VERDINO (3/3
  głosów), `PORTA LOFT model 4.A` (21/24), RESIST, „4 Żywioły Ziemia".

## Architektura

### Agregacja (backend/src/services/attributeService.ts)

```ts
// Głosy wariantów → style modelu. Większość (>50%); przy braku większości —
// styl(e) z największą liczbą głosów. Brak jakichkolwiek głosów → [] (style_none).
export function aggregateStyles(perVariant: Style[][]): Style[]
```

`classifyStyles` bez zmian — nadal produkuje głos POJEDYNCZEGO wariantu z jego
opisu. Nowa funkcja tylko je zlicza. Wszystkie warianty modelu dostają identyczne
flagi `style_*` / `style_none` (przez istniejący `styleFlags`).

### Propagacja przy imporcie (backend/src/services/styleResolver.ts — nowy)

Bliźniak `glassResolver.ts`, bez wizji i bez Gemini:

```ts
export interface WynikStylu { models: number; updated: number }
export async function resolveStylesForProducts(nowe: Array<{ id: string; name: string }>): Promise<WynikStylu>
```

Algorytm: jeden odczyt kolekcji → odfiltrowanie do `residential` → grupowanie po
`modelOf` → dla modeli dotkniętych importem przeliczenie `aggregateStyles` z opisów
WSZYSTKICH wariantów (istniejących i nowych) → `col.update` tylko na rekordach,
którym flagi się zmieniły. Na koniec unieważnia indeks przekrojów.

Wpięcie: koniec `syncCatalog.ts` (po pętli batchy) i `importService.ts` (po pętli
importu, na produktach `success`) — tam, gdzie dziś wołany jest
`resolveGlassForProducts`. Wynik do logu.

### Backfill (backend/src/scripts/backfillStyle.ts — przepisany)

Ta sama agregacja na całym katalogu: 8130 residential, 580 modeli, metadane-only,
jeden przelot. Raport: rozkład kombinacji stylów + liczba zmienionych rekordów.

### Indeks przekrojów (backend/src/services/styleIndex.ts — nowy)

```ts
export function countStyles(filters: HardFilters): Promise<Record<Style, number>>
export function invalidateStyleIndex(): void
```

Snapshot metadanych residential (id, name, color_family, has_glass, flagi stylu),
budowany leniwie przy pierwszym użyciu (3,2 s, 6,2 MB), trzymany w module.
Unieważniany przez import, sync i backfill.

`countStyles` liczy trafienia **ścisłe** (flaga stylu = `true`) przy aktywnym
kolorze, szkle i wybarwieniu — z pominięciem samego filtra stylu. Drzwi
bezstylowe liczą się jako 0 dla każdego stylu; liczba na chipie odpowiada na
pytanie „ile jest białych klasycznych", nie „ile zobaczę".

Wybarwienie jest filtrem po nazwie wariantu (nie po metadanej), więc indeks trzyma
nazwy — liczby są dokładne także przy aktywnym `finish`.

### Trasa wyszukiwania (backend/src/routes/search.ts)

Po ustaleniu `description.filters` (guardy koloru → drewna → wybarwienia → stylu):

1. `const counts = await countStyles({ ...filters, style: null })`
2. Gdy `filters.style` ustawiony i `counts[filters.style] === 0` → usuń styl
   z filtrów, zapamiętaj `droppedStyle`.
3. `styleCounts: counts` w ładunku odpowiedzi — w `/search` i `/search-text`.

`buildResultPayload(description, results, isLowSimilarity, droppedFinish, droppedStyle)`
skleja komunikat:

> „W białych nie ma drzwi rustykalnych — pokazujemy białe bez filtra stylu."

Gdy odpadły oba filtry, obie informacje trafiają do jednego pola `notice`
(zdania sklejone spacją) — typ odpowiedzi we froncie bez zmian. Mapa
`STYLE_PL` tłumaczy enum na przymiotnik w komunikacie (jak `FINISH_PL`).

`chromaService.ts` bez zmian: decyzja o pominięciu stylu należy do trasy, która
i tak liczy przekroje. `buildWhere` nadal dokleja `$or [styl, style_none]` — po
nowej regule to już tylko 26 wariantów bezstylowych.

### Frontend

- `types/index.ts`: `SearchResponse.styleCounts?: Record<string, number>`.
- `lib/api.ts`, `hooks/useSearch.ts`: przeniesienie pola z odpowiedzi do stanu.
- `App.tsx`: `styleCounts` przekazane do `Rail`.
- `Rail.tsx`: zduplikowany JSX chipa wyciągnięty do `<ChipButton>`
  (`etykieta, aktywny, disabled, count, onClick`) i użyty w obu rzędach.
  Chip stylu dostaje `count` z `styleCounts[STYLE_LABELS[etykieta]]`:
  - `count === 0` i chip nieaktywny → `disabled` + `title="brak przy obecnych filtrach"`,
  - chip aktywny → zawsze klikalny (musi dać się odkliknąć),
  - brak `styleCounts` (pierwsze wejście, stara odpowiedź) → bez liczb i bez
    wygaszania, zachowanie jak dziś.

## Testy

**Jednostkowe (backend):**
- `aggregateStyles`: większość (`[[now],[now],[klas]]` → `[nowoczesny]`),
  brak większości → lider (`[[klas],[now],[glam],[klas]]` → `[klasyczny]`, bo 2/4
  to nie większość), remis liderów → oba, brak głosów → `[]`.
- `countStyles` na fikstrze indeksu: respektuje kolor/szkło/wybarwienie, ignoruje
  filtr stylu, drzwi bezstylowe dają 0.
- `buildResultPayload`: komunikat dla samego `droppedStyle`, dla samego
  `droppedFinish` i dla obu naraz.

**Jednostkowe (front):**
- `ChipButton`: wygaszony przy `count === 0`, klikalny gdy aktywny, brak liczby
  gdy `count` niezdefiniowany.

**E2e (żywa Chroma, po backfillu):**
- Warianty jednego modelu mają identyczne flagi stylu (spójność).
- `{"query":"drzwi rustykalne"}` → modele z listy rustykalnych (VERDINO, LOFT 4.A),
  zero czysto nowoczesnych.
- `{"query":"białe drzwi rustykalne"}` → `notice` o pominięciu stylu, wyniki białe.
- `styleCounts` dla filtra `white` ma `rustykalny: 0`, `nowoczesny > 0`.

**Regresja:** backend `vitest` (134+) i `tsc --noEmit`; front `vitest` (33+),
`tsc`, `npm run build`.

## Poza zakresem

- Wizja/Gemini do stylu — opis wystarcza, głosowanie usuwa szum.
- Zmiana taksonomii 7 stylów i regexów `classifyStyles`.
- Wygaszanie chipów spoza grupy „styl" (jasność, szkło, materiał).
- Filtr wielu stylów naraz (grupa `styl` nadal się wypiera).
- `categorizeDoor` klasyfikuje `PORTA Steel EI 60 Plus` (stalowe przeciwpożarowe)
  jako `residential`. Po tej zmianie przestanie być widoczny przy filtrze stylu,
  ale błąd zostaje — osobne zadanie.

## Definicja ukończenia

Backfill nadał spójne flagi wszystkim wariantom modelu; testy jednostkowe zielone;
backend 134+ i front 33+ zielone; `tsc` i build czyste; e2e potwierdza spójność
wariantów, ostre zawężenie „rustykalne", komunikat przy pustym przekroju i
`rustykalny: 0` w `styleCounts` dla białych. Punkt powrotu: `master` @ 5b6a4cd.
