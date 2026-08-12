# Otwarte zadania — stan na 2026-08-12

Lista tego, co zostało do naprawy, z decyzjami eksperta domenowego i wskazaniem,
gdzie szukać. Cel: domknąć w jednej sesji.

## 1. Kategorie drzwi — DECYZJA PODJĘTA, do wdrożenia

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

## 2. Skandynawski — DECYZJA: poprawić klasyfikator

W całej bazie **2 warianty w 2 modelach** (PORTA FACTOR model 3, PORTA EXTREME RC 3
model intarsje 6). Wizja widziała skandynawski w **137 z 580 modeli**. Reguły w
`classifyStyles` (`backend/src/services/attributeService.ts`) praktycznie nigdy go nie
przyznają. Ekspert domenowy wybrał poprawę reguł, nie tabelę korekt — ma działać automatycznie
na cały katalog.

Sygnał do wychwycenia: jasne drewno PLUS prostota, nie samo „light coloured" — ta granica
jest już opisana w prompcie wizji w `backend/src/scripts/visionStylePass.ts`.
Propozycje wizji leżą w `scripts/vision_style_proposals.json` (lokalne, w `.gitignore`)
— dobra próbka do kalibracji reguł.

## 3. Szkło — resztki po naprawie kategorii

Po usunięciu drzwi wejściowych zostają trzy modele wewnętrzne z `has_glass=false`,
które szybę mają (dowód: nazwa pliku packshotu zawiera „czarna szyba"):

- `PORTA RESIST model B.1` — 8 wariantów
- `PORTA FOCUS PREMIUM model 4.A` — 2 warianty
- `PORTA UNI KOLOR MODERN model 4.A` — 1 wariant

Naprawa: trzy wpisy `{"has_glass": true}` w `docs/style-overrides.json` + `applyOverrides.ts`.

## 4. Zgłoszenia z przeglądu A–I, wciąż otwarte

Pełna checklista i dosłowne zgłoszenia: `docs/manual-review-checklist.md`.

- **A** — `drzwi dębowe` pokazuje białe; `ciemny orzech` gubi kolor (Dąb Matowy Ciemny,
  Mocca, Hikora, Dąb Hawana zamiast orzecha)
- **B** — `drewno naturalne` wraca do widoku domyślnego, jakby chip nie był zaznaczony;
  `pełne jasne drzwi` wpuszcza drzwi z intarsjami
- **F** — liczba wariantów w konfiguratorze („N wariantów") nie zgadza się
- **UI** — lewy panel nie scrolluje się pod kursorem (scrolluje środek, dopiero potem lewa
  strona); kolejność „cena, potem od" zamiast „od, potem cena"; zbędny drugi link
  ze słowem „konfigurator"
- **Nowe** — do wyniku 10 doładowywać kolejne przez lazy load

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
