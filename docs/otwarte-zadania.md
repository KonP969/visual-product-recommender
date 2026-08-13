# Otwarte zadania — stan na 2026-08-12

Lista tego, co zostało do naprawy, z decyzjami eksperta domenowego i wskazaniem,
gdzie szukać. Cel: domknąć w jednej sesji.

## 1. Kategorie drzwi — WDROŻONE

**Zaimplementowano 2026-08-12** (plan `docs/superpowers/plans/2026-08-12-feed-door-categories.md`):
katalog 10873 → 6360 rekordów, 580 → 522 modeli. Rzeczywiste liczby ofert w feedzie
dla usuwanych kategorii były wyższe niż w tabeli poniżej (2548 wejściowe, 1806
techniczne, 89 przesuwne, 70 składane) — tabela poniżej zachowana jako historyczny
zapis decyzji, nie jako dokładny licznik.

**Dopisek 2026-08-13:** finalny przegląd wdrożenia znalazł 57 wariantów (8 modeli
`PORTA STEEL SAFE` + `System przesuwny bezościeżnicowy`) z PUSTYM `category_main`
w feedzie — reguła "brak kategorii = drzwi wewnętrzne" ich nie odsiewała, mimo że
to drzwi wejściowe wzmacniane/przesuwne. Ekspert domenowy zdecydował: mają nie
pojawiać się w wynikach. Naprawione przez rozszerzenie `COMMERCIAL_DOOR_PATTERNS`
w `chromaService.ts` (`steel safe`, `bezościeżnicowy`) + jednorazowy backfill
`backend/src/scripts/backfillCategory.ts` (przelicza `category` z nazwy dla już
zaimportowanych rekordów — 57 rekordów `residential` → `specialty`, katalog
6360 → 6360, bo to przekategoryzowanie, nie usunięcie). Modeli 522 → 513.

**Problem:** feed Porty ma pole `category_main`, ale projekt czyta je wyłącznie po to,
żeby odsiać klamki i ościeżnice (`isDoorProduct` w `backend/src/services/chromaService.ts`).
Czy drzwi są wewnętrzne, zgaduje `categorizeDoor` z NAZWY — denylistą, więc wszystko
nierozpoznane ląduje jako `residential`. Skutek: **1919 wariantów w 88 modelach** siedzi
w wynikach dla wnętrza, choć wewnętrznymi drzwiami nie są.

| Kategoria z feedu | Modeli | Wariantów | Decyzja |
|---|---|---|---|
| Drzwi wejściowe do mieszkania | 27 | 1425 | **USUNĄĆ** (AGAT, OPAL) |
| Drzwi techniczne | 16 | 187 | **USUNĄĆ** (ENDURO, Steel EI 60, PORTA 4 Klasa Mechaniczna) |
| Drzwi przesuwne | 13 | 89 | **USUNĄĆ** (HIDE, EFEKT, SLIDE, System przesuwny BLACK) |
| Drzwi składane | 2 | 70 | **USUNĄĆ** (BETA, ALFA) |
| Drzwi szklane | 9 | 80 | **ZOSTAWIĆ** (PORTA LUMIA) |
| Porta Loft Steel | 21 | 68 | **ZOSTAWIĆ** |
| (brak kategorii) | 47 | 378 | ZOSTAWIĆ — feed nie ma tam pola, a to realne modele wewnętrzne (KWARC, PORTA STYL, PORTA NOVA) |

**Uwaga o kolejności:** usunięcie drzwi wejściowych zabiera AGAT P.1/P.3 i OPAL P.1/P.3
(262 warianty) — czyli większość zgłoszenia „bez przeszklenia pokazuje przeszklone"
rozwiązuje się przy okazji. Kategorie robić PRZED korektą szkła.

**Konsekwencja dla tabeli korekt:** po usunięciu przesuwnych wpisy
`System przesuwny BLACK` i `System Przesuwny BLACK` w `docs/style-overrides.json`
staną się martwe — usunąć je.

## 2. Skandynawski — PRÓBA PODJĘTA 2026-08-13, architektonicznie nierozwiązywalne bez zmiany modelu danych

**Diagnoza:** styl w tym projekcie to cecha CAŁEGO MODELU (identyczna flaga na
wszystkich wariantach kolorystycznych) — liczona głosowaniem większościowym po
opisach wariantów (`aggregateStyles` w `attributeService.ts`), a
`checkStyleConsistency.ts` twardo pilnuje, że żaden model nie ma rozjechanych flag
między wariantami. Skandynawskość zależy jednak od KONKRETNEGO KOLORU wariantu
("pale wood" — jasne drewno), nie od konstrukcji modelu (w przeciwieństwie do
loftu/rustykalnego, które są niezależne od koloru). Większość modeli ma zarówno
jasne, jak i ciemne wybarwienia, więc żaden pojedynczy wariant nigdy nie osiąga
>50% głosów na poziomie modelu.

**Co zaimplementowano:** `classifyStyles(description, colorFamily)` w
`attributeService.ts` dokłada `skandynawski`, gdy wariant ma jednocześnie
`color_family: light_wood` I sygnał "minimalistyczny" w opisie — dokładnie granica
z prompta wizji ("pale wood AND deliberately light, airy, simple — not merely
light coloured"). Przewleczone przez `styleResolver.ts`
(`stylesForModel`/`stylesForModelName` przyjmują teraz `colorFamilies` per
wariant) i `backfillStyle.ts`. Pokryte testami w `attributeService.test.ts` i
`styleResolver.test.ts`.

**Efekt na żywym katalogu: 0 rekordów zmienionych.** Sprawdzone dwiema drogami —
głosowanie większościowe (0 modeli osiąga próg) i alternatywa "choć jeden wariant
pasuje → cały model" (dałoby 145 modeli / 2716 wariantów, ale oznaczałoby też
CZARNE/ciemne warianty tych modeli jako skandynawskie — dokładnie ten sam błąd
nadmiernej hojności, o który oskarżono wizję). **Decyzja eksperta domenowego:
zostawić głosowanie większościowe bez zmian.** Reguła w kodzie jest poprawna i
zadziała sama, jeśli kiedyś do katalogu trafi model przeważająco jasny i prosty —
ale przy obecnym składzie katalogu nic nie zmienia. §2 uznajemy za zamknięte w
obecnej architekturze; realne odblokowanie wymagałoby zerwania z zasadą "styl =
jedna etykieta na cały model" konkretnie dla tego stylu (osobny temat, nie
podjęty).

Propozycje wizji (137 z 580 modeli, dziś nieaktualne po czyszczeniu z §1) leżą w
`scripts/vision_style_proposals.json` (lokalne, w `.gitignore`) — NIE traktować
jako źródło prawdy, patrz "Czego NIE próbować ponownie" niżej.

## 3. Szkło — resztki po naprawie kategorii

Po usunięciu drzwi wejściowych zostają trzy modele wewnętrzne z `has_glass=false`,
które szybę mają (dowód: nazwa pliku packshotu zawiera „czarna szyba"):

- `PORTA RESIST model B.1` — 8 wariantów
- `PORTA FOCUS PREMIUM model 4.A` — 2 warianty
- `PORTA UNI KOLOR MODERN model 4.A` — 1 wariant

Naprawa: trzy wpisy `{"has_glass": true}` w `docs/style-overrides.json` + `applyOverrides.ts`.

## 4. Zgłoszenia z przeglądu A–I, wciąż otwarte

Pełna checklista i dosłowne zgłoszenia: `docs/manual-review-checklist.md`.

**Dopisek 2026-08-13 — pełne przejście A–I (Playwright + API):**

- **A** — `drzwi dębowe` i `ciemny orzech` NIE reprodukują się już (obecnie: czysto
  dąb / czysto ciemny orzech, z odpowiednimi `color_family`). Naprawione w
  międzyczasie (guard `explicitFinishFromQuery`/`explicitWoodFromQuery` w
  `backend/src/routes/search.ts`), ale ten wpis nigdy nie został odhaczony — poprawiono
  teraz. **Nowy bug tej samej rodziny, znaleziony i naprawiony dziś:** 8 wariantów
  (`PORTA GRANDE ... z czarną szybą` / `PORTA DESIRE ... Czarne Intarsje`, oba w kolorze
  Szałwia) miało `color_family: black` — zapytanie `drzwi czarne` zwracało zielone
  drzwi. Przyczyna: „Szałwia” nie miała reguły wariantu, klasyfikacja spadała na opis
  Gemini, gdzie słowo „black” (opisujące akcent, nie płycinę) wygrywało. Naprawa:
  `backend/src/services/attributeService.ts` (dodano „szałwia” do reguły `grey`) +
  backfill `backend/src/scripts/backfillColorFamily.ts` (68 wariantów Szałwia w całym
  katalogu, nie tylko 8 złamanych — reszta była wcześniej `unknown`).
- **B** — `bez przeszklenia`/`ze szkłem`/`pełne jasne drzwi` zweryfikowane jako poprawne
  (zero/same przeszklone, `hasGlass` się zgadza). `pełne jasne drzwi` zwraca modele z
  „intarsje” w NAZWIE (to nazwa linii produktowej, nie widoczne przeszklenie —
  `hasGlass=false` na każdym), więc jeśli zgłoszenie miało na myśli dekoracyjne wstawki,
  a nie szkło, to nadal osobna kwestia UX, nie sprawdzona dziś wprost. `drewno naturalne`
  NIE przetestowane dziś wprost (przypadkowe kliknięcie w trakcie innego testu nie dało
  jednoznacznego wyniku) — status nieznany, do sprawdzenia osobno.
- **F** — liczba wariantów w konfiguratorze (na stronie porta.com.pl, poza tym repo) —
  nie sprawdzone dziś, nadal otwarte.
- **UI** — scroll lewego panelu / kolejność cena-„od” / zbędny link konfiguratora —
  nie sprawdzone dziś, nadal otwarte.
- **Nowe** — lazy load po 10 wynikach — nie zaimplementowane, nadal otwarte.

Reszta (D, C, E, G, H, I) zweryfikowana dziś jako działająca poprawnie — patrz transkrypt
sesji 2026-08-13, nie zapisane tu osobno bo nie są to zgłoszenia tylko potwierdzenia.

## 5. Backlog techniczny z wcześniejszych sesji

- `useSearch.ts` gubi `notice` i `styleCounts`, gdy lista produktów jest pusta — czyli
  dokładnie wtedy, gdy komunikat jest najbardziej potrzebny
- fallback w `searchSimilar` nie stosuje filtrów
- przy odklikaniu chipa stylu tekst z bazy może przywrócić styl przez guard
- redundantny spread `[...większość]` w `attributeService.ts`

## Czego NIE próbować ponownie

- **Przelotu wizji do rozstrzygania szkła.** Zbadane i udokumentowane w
  `docs/superpowers/specs/2026-08-04-style-glass-overrides-design.md`: przy modelu E.4
  wizja nie została pominięta, tylko odpowiedziała źle, a powtórzenie na pełnej
  rozdzielczości, trzech promptach, czterech rodzinach modeli i powiększonym wycinku daje
  ten sam błąd. Wąskie pasy szkła satynowego i czarnego lacobelu są dla wizji „listwą
  metalową".
- **Wizji jako arbitra stylu.** Rozdaje `rustykalny` zbyt hojnie (`System przesuwny BLACK`
  8/8, `PORTA CLASSIC HOME` 6/7) i jednocześnie nie widzi go tam, gdzie ekspert domenowy
  widzi (VECTOR 0/12). Wizja proponuje, ekspert domenowy rozstrzyga.
- **Zgadywania typu drzwi z nazwy.** To źródło problemu z punktu 1 — feed ma
  `category_main` i to jest źródło prawdy.
