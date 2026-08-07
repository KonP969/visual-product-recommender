# Checklista ręcznego przeglądu UI (A–I)

Scenariusz przeklikania aplikacji pod `http://localhost:5173`. Powstał przy przeglądzie
z lipca 2026 i jest przenoszony między sesjami — dlatego leży w repo, a nie w transkrypcie.

Przy każdym punkcie: konkretne zapytanie i czego oczekiwać. Gdy coś nie zagra, notuj
**dokładnie wpisany lub kliknięty tekst plus nazwę winnego produktu** (ewentualnie
`external_id`) — tak jak przy błędzie ze szkłem, gdzie dopiero konkret przesądził diagnozę.

## A — Twarde filtry koloru

- `drzwi czarne` → wyłącznie czarne, zero brązów
- `drzwi białe` → same białe (nie beż/kaszmir)
- `drzwi dębowe` → tylko dąb
- `drzwi w kolorze ciemnego orzecha` → ciemny orzech

## B — Negacja szkła

- Chip „bez przeszklenia" → **zero** drzwi z szybą
- Chip „ze szkłem" → same przeszklone; powinny dochodzić modele bez słowa „szyba"
  w nazwie (np. CLASSIC HOME C.2, FIT H.1)
- `pełne jasne drzwi` → zero szkła, jasne

## C — Korekty względne

- `… ale jaśniejsze` / `… ale ciemniejsze` → realnie jaśniejszy/ciemniejszy zestaw
- Test guardu: `czarne` = dokładnie czarne, ale `czarne, ale trochę jaśniejsze` → już nie czarne

## D — Chipy UI (widoczna kumulacja)

- Po wgraniu zdjęcia klikaj chipy → pojawia się sekcja „Doprecyzowanie" z żetonami i „cofnij"
- `×` na żetonie zdejmuje pojedynczy warunek; „cofnij" cofa ostatni
- Blockquote „Nasza rekomendacja stylu" NIE zmienia się po kolejnych chipach (zamrożona baza)
- „← zacznij od nowa" → pełny reset do ekranu uploadu

## E — Filtr stylu (osobny rząd „Styl", 7 chipów)

- Klik „klasyczne" → tylko klasyczne; zero oczywiście nowoczesnych
- Klik innego stylu (np. „loftowe") → wypiera poprzedni (zawsze jeden aktywny)
- Mały styl („skandynawskie", „glamour") → zwraca propozycje, nie pustkę;
  chip bez ani jednego trafienia jest wygaszony
- Wpisany tekst: `loftowe drzwi`, `rustykalne drzwi` → odpowiednio zawężone
- Klucz: styl z chipa działa, nawet gdy opis bazowy sam zawiera słowo stylu

## F — Zwijanie wariantów

- W siatce nie ma dwóch kart o tej samej nazwie (model+kolor)
- Karty z wariantami pokazują cenę „od X zł" oraz liczbę wariantów w konfiguratorze
- Link „konfigurator →" prowadzi do właściwej rodziny

## G — Wirtualny projektant (upload zdjęcia)

- Dwa różne zdjęcia wnętrz → różne wyniki; to samo zdjęcie dwa razy → stabilne
- Sekcja „A gdyby tak zaszaleć?" → realnie kontrastowa i **nie** ograniczona filtrem stylu
- Opisy pod kartami nie kłamią o kolorze (Szary ≠ „grafitowy")

## H — Nowe produkty po imporcie

- `PORTA FIT G.1` albo `PORTA FOCUS` → nowe modele są w wynikach, z ceną, obrazem, linkiem
- Nagłówek katalogu pokazuje aktualną liczbę modeli

## I — UI i linki

- Kilka „konfigurator →" → linki żywe (nie 404)
- Skeleton packshotów, layout side-by-side, paleta bez rozjazdów
- Panel administratora (na dole) rozwija się

---

## Zgłoszenia z przeglądu (lipiec 2026)

Zapis tego, co ekspert domenowy zobaczył przy przeklikaniu. Zachowany dosłownie,
bo konkretne nazwy modeli okazały się kluczowe przy diagnozie.

**Uwagi ogólne**

1. Lewy panel nie skroluje się, gdy kursor jest nad lewą stroną — najpierw scrollują się
   drzwi (część centralna), a lewa strona dopiero, gdy tamto się skończy.
2. Kolejność „cena, potem »od«" zamiast „»od«, potem cena".
3. Drugi link do konfiguratora jako słowo „konfigurator" jest zbędny.

**A** — `drzwi dębowe` pokazuje białe zamiast dębowych. `drzwi w kolorze ciemnego orzecha`
pokazuje inne kolory z ciemnego klimatu (Dąb Matowy Ciemny, Mocca, Hikora, Dąb Hawana).

**B** — `bez przeszklenia` na końcu listy pokazał `PORTA VERTE PREMIUM model E.4`, który ma
małe szybki. `ze szkłem` działa. `drewno naturalne` pokazało drzwi lakierowane — wygląda,
jakby wróciło do widoku domyślnego, bez zaznaczonego chipa. `pełne jasne drzwi` nie działa,
weszły też drzwi z intarsjami.

**C, D, G, H, I** — działa.

**E** — nie działa: `rustykalne` wyświetla drzwi stalowe, a powinno coś w stylu OSLO,
NATURA OSLO, NATURA VECTOR, VIGO, VERTE HOME model M, CRAFT, VALLO — typowo rustykalne,
„ala zbite z desek". Pytanie, czy system w ogóle jest w stanie sam określić styl.

**F** — działa poza liczbą wariantów w konfiguratorze.

---

## Status

Rozliczone (2026-08-06, gałąź korekt stylu i szkła):

- **B, przypadek E.4** — `PORTA VERTE PREMIUM model E.4` ma `has_glass: true` na wszystkich
  32 wariantach. Automat nie miał jak tego rozstrzygnąć: cztery wąskie pasy szkła satynowego
  są przez cztery różne rodziny modeli wizyjnych zgodnie czytane jako listwa metalowa
  (dowody w `docs/superpowers/specs/2026-08-04-style-glass-overrides-design.md`). Decyzja
  siedzi w `docs/style-overrides.json` i przeżywa każdy import.
- **E, kolekcje rustykalne** — CRAFT, VALLO, VIGO, PORTA OSLO, NATURA OSLO, VECTOR PREMIUM,
  NATURA VECTOR, oba systemy przesuwne BLACK oraz cztery modele `VERTE HOME, model M`
  dostały styl `rustykalny` z tabeli korekt. Liczba wariantów rustykalnych: 97 → 372.
  Odpowiedź na pytanie „czy system sam potrafi": nie w pełni — opisy EN mówią o tych
  drzwiach „modern flat panel", a wizja rozdaje `rustykalny` zbyt hojnie (`System
  przesuwny BLACK` 8/8, `PORTA CLASSIC HOME` 6/7). Dlatego wizja proponuje, a rozstrzyga
  ekspert domenowy.

Pozostałe zgłoszenia z tej listy były rozliczane we wcześniejszych sesjach — ich stan
czytaj z historii gita, ten plik ich nie śledzi.
