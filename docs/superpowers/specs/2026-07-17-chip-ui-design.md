# Widoczna kumulacja doprecyzowań (chip UI)

Data: 2026-07-17
Gałąź: `feat/chip-ui` · Punkt powrotu: tag `stabilna-2026-07-16`

## Problem

Użytkownik zgłosił (checklista, punkt B): po wyszukaniu „dębowych", a potem
kliknięciu „klasyczne", wyniki to „dębowe-klasyczne" — kliknięcia się kumulują,
ale interfejs tego nie pokazuje. Do tego zachowanie jest niespójne: **chip
dokleja** się do poprzedniego zapytania (`Rail.tsx:42`), a **wpisany tekst
resetuje** kontekst (`handleSubmit`). Użytkownik nie ma jak tego odróżnić.

Głębsza przyczyna, wykryta podczas projektowania: chip bierze `displayDescription`
— czyli **wyjście LLM-a** z poprzedniego kroku — i wkleja je jako **wejście**
kolejnego. LLM parafrazuje z naddatkiem (zaobserwowane: „dębowe drzwi, ale
klasyczne" → „dębowe drzwi, klasyczne, **z widocznym usłojeniem**"). Po kilku
krokach zapytanie dryfuje od tego, co użytkownik faktycznie kliknął. To ta sama
choroba co „grafitowy" na szarych drzwiach: proza LLM-a traktowana jako stan.

## Decyzje (ustalone z użytkownikiem)

1. **Model mentalny:** rozmowa z jawną kumulacją (nie filtry-przełączniki).
2. **Pole tekstowe:** też dokleja, jak chip. Reset tylko przez jawny przycisk.
3. **Sprzeczności:** nowy warunek wypiera stary z tej samej grupy
   („ze szkłem" ↔ „bez przeszklenia", „jaśniejsze" ↔ „ciemniejsze”).
   LLM nigdy nie dostaje sprzecznego zapytania.
4. **Zakres:** zmiana wyłącznie we froncie. Backend, atrybuty, wildcard i
   wyszukiwanie po zdjęciu — nietknięte.

## Architektura

Cały stan zapytania trafia do nowego, czystego hooka `useRefinement`
(bez sieci, bez efektów) — testowalnego jednostkowo bez backendu.
`useSearch` zostaje transportem.

```ts
export type Grupa = 'szkło' | 'jasność' | 'styl' | 'materiał' | 'własne'

export interface Krok {
  etykieta: string          // słowa użytkownika, np. "bez przeszklenia"
  grupa: Grupa
  spójnik: 'ale' | ','      // wynika z grupy, nie z widzimisię
}

export interface StanZapytania {
  baza: string | null       // ustawiana RAZ, z displayPl pierwszego wyszukiwania
  kroki: Krok[]
}
```

### Definicja chipów

| Etykieta            | Grupa     | Spójnik |
|---------------------|-----------|---------|
| jaśniejsze          | jasność   | ale     |
| ciemniejsze         | jasność   | ale     |
| ze szkłem           | szkło     | ,       |
| bez przeszklenia    | szkło     | ,       |
| drewno naturalne    | materiał  | ,       |
| klasyczne           | styl      | ,       |

Wpisany tekst → krok w grupie `własne`, spójnik `,`.

### Operacje (czysto na tablicy `kroki`)

- `dodajKrok(krok)` — jeśli `grupa !== 'własne'`, najpierw usuń istniejący krok
  tej samej grupy, potem dopnij na koniec (to realizuje wypieranie).
  Grupa `własne` zawsze się kumuluje.
- `usuńKrok(index)` — dla × na żetonie oraz dla ponownego kliknięcia aktywnego chipa.
- `cofnij()` — zdejmuje ostatni krok; na pustej liście no-op.
- `wyczyść()` — reset do samej bazy.

Ponowne kliknięcie aktywnego chipa (ta sama grupa + etykieta) → `usuńKrok`
(nie no-op, nie duplikat).

### Budowanie zapytania — zawsze od zera, nigdy przyrostowo

```ts
kroki.reduce(
  (q, k) => (k.spójnik === 'ale' ? `${q}, ale ${k.etykieta}` : `${q}, ${k.etykieta}`),
  baza,
)
```

**Reguła krytyczna (sedno poprawki):** `baza` ustawiana jest wyłącznie z
`displayPl` **pierwszego** wyszukiwania po zdjęciu. Wyniki kolejnych wyszukiwań
**nigdy** jej nie nadpisują — tu umiera dryf.

Przypadek brzegowy: `baza` bywa `null`, gdy pierwsze wyszukiwanie nie zwróciło
`displayPl` (Gemini padł / low-similarity). Wtedy przy pierwszym `dodajKrok`
etykieta kroku staje się bazą **zamiast** trafić na listę `kroki` (bez
duplikacji). Kolejne kroki dopinają się normalnie. Gdy `baza !== null`, każdy
krok — łącznie z pierwszym — trafia na listę.

## UI (render w `Rail.tsx`)

```
NASZA REKOMENDACJA STYLU
┃ dębowe drzwi w ciepłym,
┃ minimalistycznym wnętrzu        ← baza, zamrożona

DOPRECYZOWANIE          ↶ cofnij
[ klasyczne × ] [ bez przeszklenia × ]

[ jaśniejsze ]  [ ciemniejsze ]
[ ze szkłem ]   [ ●bez przeszklenia ]
[ drewno naturalne ]  [ ●klasyczne ]

[ dopisz własnymi słowami…  ] [Szukaj]

← zacznij od nowa
```

- Sekcja **DOPRECYZOWANIE** renderuje się tylko gdy `kroki.length > 0`; przy
  zerze znika (pierwszy ekran wygląda jak dziś).
- Aktywne chipy palety: wypełnione (`●`), `aria-pressed`. Klik aktywnego =
  `usuńKrok` (druga droga obok ×).
- Blockquote „Nasza rekomendacja stylu" **zamarza** na opisie wnętrza ze
  zdjęcia (dziś przepisuje się co krok — źródło dryfu). Historia doprecyzowań
  przenosi się do sekcji DOPRECYZOWANIE.
- Placeholder pola: „albo opisz własnymi słowami…" → „dopisz własnymi słowami…".
- Dostępność: `aria-pressed` na chipach, `aria-live="polite"` na sekcji
  DOPRECYZOWANIE.

## Testy

### Jednostkowe (`useRefinement`) — TDD, przed kodem

- `dodajKrok` w nowej grupie → dopina; w zajętej → wypiera (jeden krok `szkło`)
- grupa `własne` kumuluje (dwa wpisane teksty = dwa kroki)
- ponowny klik aktywnego chipa → usuwa
- klik chipa gdy grupa pusta → dopina
- `cofnij` zdejmuje ostatni; pusta lista → no-op
- `wyczyść` → zostaje sama baza
- budowanie zapytania: `ale` tylko dla `jasność`; `"dąb, ale jaśniejsze, bez przeszklenia"`
- **baza zamrożona** po dwóch doprecyzowaniach (najważniejszy test — na dryf)
- baza `null` przy wejściu z tekstu → pierwszy krok staje się bazą

### E2e (ręczne + curl na `/api/search-text`, patrząc na `hasGlass`)

1. zdjęcie → „klasyczne" → „bez przeszklenia" → dwa żetony, wyniki bez szkła
2. „ze szkłem" → „bez przeszklenia" znika, wyniki ze szkłem (dowód wypierania)
3. × na „klasyczne" → zostaje szkło, przeszukanie
4. „cofnij" cofa ostatni krok
5. „zacznij od nowa" → pełny reset, ekran uploadu

## Ryzyka

- **Baza `null` (próbka/tekst)** → pierwszy krok staje się bazą; pokryte testem.
- **Regresja modelu rozmowy** → jeśli po przeklikaniu użytkownik wolałby filtry,
  zmienia się **tylko render w `Rail.tsx`**; `useRefinement` i testy zostają.
  To wybór kosmetyczny, nie architektoniczny.
- **Wyjście awaryjne** → `git reset --hard stabilna-2026-07-16`; `master` nietknięty.

## Definicja ukończenia

Nowe testy zielone, całość (82+) zielona, typecheck czysty, 6/6 e2e jakości bez
zmian, pięć kroków e2e odklikanych w przeglądarce pod http://localhost:5173.
