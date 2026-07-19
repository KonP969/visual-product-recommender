# Filtr stylu — twardy filtr po 7 stylach (metka-zbiór)

Data: 2026-07-19
Gałąź: `feat/style-filter` · Baza: `master` @ cdc7230

## Problem

Kolor i szkło mają twarde filtry w Chromie (`where`), ale **styl jedzie wyłącznie
na podobieństwie CLIP** — stąd zgłoszone przez użytkownika „klik «klasyczne» jakby
nie wyszukiwał klasycznych" (checklista, punkt B). Trzeba dać stylowi twardy filtr,
jak kolorowi.

## Decyzje (ustalone z użytkownikiem)

1. **7 stylów**, generycznych (branżowych, nie brandowych Porty): klasyczny,
   nowoczesny, minimalistyczny, rustykalny, loft, skandynawski, glamour.
2. **Twardy filtr** (jak kolor), nie miękki re-ranking.
3. **Metka-zbiór (multi-label):** drzwi dostają WSZYSTKIE style, które potwierdza
   opis — nie jeden arbitralny kubełek. To usuwa ryzyko „zła metka → drzwi znikają".
4. **Zabezpieczenie:** drzwi bez wykrytego stylu (~5%, 423 szt.) NIGDY nie są
   odcinane przez filtr stylu — pokazują się przy każdym stylu.
5. **Źródło klasyfikacji:** opis EN (już w metadanych), bez wizji, bez Gemini.
6. **Chipy:** wszystkie 7 w osobnym, podpisanym rzędzie „Styl" we froncie.
7. **Chip wysyła styl WPROST** (nie przez tekst) — bo opis bazowy często sam
   zawiera słowo stylu; jawne pole = 100% niezawodności chipa. Wpisany tekst →
   LLM + deterministyczny guard.

## Taksonomia i słowa-sygnały (zwalidowane na katalogu)

| Styl (enum) | Regex sygnału (na opisie EN) | Drzwi | % |
|---|---|---|---|
| `klasyczny` | `\bclassic|traditional|raised[ -]?panel` | 1700 | 21% |
| `nowoczesny` | `\bmodern|contemporary` | 6176 | 77% |
| `minimalistyczny` | `minimalist` | 1822 | 22% |
| `rustykalny` | `rustic|farmhouse|knotty` | 771 | 9% |
| `loft` | `\bloft|industrial` | 257 | 3% |
| `skandynawski` | `scandinav|nordic` | 110 | 1% |
| `glamour` | `glamou?r|luxur|ornate|baroque|ozdobn` | 218 | 2% |

Bez żadnego stylu: 423 (5%) → `style_none`. Świadomie: `nowoczesny` jest szeroki
(77%), bo katalog realnie jest w większości nowoczesny — filtr „nowoczesne" słabo
zawęża, ale to prawda o danych, nie błąd. `klasyczny`/`rustykalny`/`loft` filtrują ostro.

## Architektura

### Klasyfikator (backend/src/services/attributeService.ts)

```ts
export const STYLES = ['klasyczny','nowoczesny','minimalistyczny','rustykalny','loft','skandynawski','glamour'] as const
export type Style = (typeof STYLES)[number]

// Multi-label: zwraca WSZYSTKIE style, które potwierdza opis. Puste = unknown.
export function classifyStyles(description: string): Style[]
```

`classifyDoor` zyskuje `styles: Style[]` w `DoorAttributes` (obok colorFamily/hasGlass/lightness).

### Przechowywanie (Chroma — metadane boolean)

Chroma trzyma wartości skalarne, więc metka-zbiór = 7 flag boolean + `style_none`:
`style_klasyczny`, `style_nowoczesny`, `style_minimalistyczny`, `style_rustykalny`,
`style_loft`, `style_skandynawski`, `style_glamour`, `style_none`.

Helper (backend/src/services/attributeService.ts):
```ts
// { style_klasyczny: bool, …, style_none: bool } — style_none true gdy styles pusty
export function styleFlags(styles: Style[]): Record<string, boolean>
```
`ProductMetadata` rozszerzona o te 8 pól (opcjonalne).

### Filtr (backend/src/services/chromaService.ts)

- `HardFilters` zyskuje `style?: Style | null`.
- `buildWhere`: gdy `style` ustawiony, dodaj warunek z zabezpieczeniem:
  ```ts
  conditions.push({ $or: [{ ['style_' + filters.style]: true }, { style_none: true }] })
  ```
  → drzwi z tym stylem PLUS bezstylowe (nigdy nie chowamy bezstylowych).

### Deterministyczny guard (backend/src/services/attributeService.ts)

```ts
// Jawnie nazwany pojedynczy styl w tekście → enum. Zero/wiele → null (LLM decyduje).
export function explicitStyleFromQuery(query: string): Style | null
```
Mapowanie PL→enum: „klasyczn"→klasyczny, „nowoczesn|modern"→nowoczesny,
„minimalist"→minimalistyczny, „rustykaln|rustic"→rustykalny, „loft|industrial"→loft,
„skandynawsk|scandinav"→skandynawski, „glamour|glamur"→glamour. Wynik tylko gdy
DOKŁADNIE jeden styl (jak `explicitColorFromQuery`).

### LLM (backend/src/services/geminiService.ts)

- `SearchFilters` zyskuje `style: Style | null`.
- FILTERS_RULES: reguła emisji stylu, gdy klient jawnie nazwie styl.
- `parseDoorDescription`: waliduje `style` ∈ STYLES, inaczej null.

### Ścieżka wyszukiwania (backend/src/routes/search.ts)

- `/search-text` przyjmuje opcjonalne `style` w body (obok `query`).
- Gdy `style` podane JAWNIE (z chipa) → `description.filters.style = style` (pomija guard/LLM).
- Gdy brak → `explicitStyleFromQuery(query)` guard (jak `explicitColorFromQuery`), potem LLM.

### Frontend

- `refinement.ts`: `CHIPY` — dodać 6 stylów do istniejącej grupy `styl` (jest już „klasyczne”).
  Etykiety: klasyczne, nowoczesne, minimalistyczne, rustykalne, loftowe, skandynawskie, glamour.
  Grupa `styl` → wypieranie (jeden styl naraz — zgodne z pojedynczym filtrem).
- Mapa etykieta→Style enum (dla wysłania jawnego stylu).
- `Rail.tsx`: chipy grupy `styl` renderowane w osobnej, podpisanej sekcji „Styl";
  reszta chipów (jasność/szkło/materiał) w dotychczasowym rzędzie.
- `useSearch`/`api.ts`: `searchByText(query, { style })` — przekazać aktywny styl
  (z `refinement.stan.kroki` grupy `styl`) do `/search-text`.

### Backfill + import

- Nowy skrypt `backfillStyle.ts`: czyta cały residential, klasyfikuje z opisu
  (`classifyStyles`), zapisuje flagi `style_*` + `style_none`. Metadane-only, bez
  embeddingu, bez Gemini. Wznawialny nie musi być (szybki, jeden przelot).
- `syncCatalog.ts` + `importService.ts`: dołożyć `...styleFlags(attrs.styles)` do
  metadanych przy zapisie (obok color_family/has_glass).

## Testy

- **Jednostkowe:** `classifyStyles` (multi-label: „modern minimalist” → [nowoczesny,
  minimalistyczny]; „classic raised panel” → [klasyczny]; brak → []); `styleFlags`
  (poprawne 8 flag, style_none gdy puste); `explicitStyleFromQuery` (pojedynczy →
  enum, wiele/zero → null); `buildWhere` z `style` (produkuje $or z style_none).
- **E2e:** backfill przeklasyfikował katalog (flagi obecne); „drzwi klasyczne”
  (tekst) → tylko klasyczne + bezstylowe, zero czysto-nowoczesnych; „loftowe drzwi”
  ostro zawęża; chip „klasyczne” (jawny styl) → identyczny wynik jak tekst.
- **Regresja:** backend vitest (90+), typecheck; front vitest (18+), typecheck, build.

## Poza zakresem

- Wizja/Gemini do stylu (nie trzeba — styl jest w opisie).
- Zmiana `classifyDoor` koloru/szkła.
- Miękki re-ranking (świadomie odrzucony na rzecz twardego filtra).

## Definicja ukończenia

Testy jednostkowe zielone; backend 90+ i front 18+ zielone; typecheck/build czyste;
backfill nadał flagi; e2e: „klasyczne” (chip i tekst) zwraca klasyczne+bezstylowe
bez czysto-nowoczesnych, „loft” ostro zawęża. Punkt powrotu: `master` @ cdc7230.
