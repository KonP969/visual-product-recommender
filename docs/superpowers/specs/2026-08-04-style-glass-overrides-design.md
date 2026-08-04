# Tabela korekt stylu i szkła + wizja jako propozycja

Data: 2026-08-04
Gałąź: `master` · Punkt powrotu: `master` @ 2096235

## Problem

Dwa zgłoszenia z ręcznej checklisty pozostały otwarte, bo oba wynikają z tego samego:
**metadane opisują drzwi lepiej niż potrafi to wyczytać maszyna z tego, czym dysponuje.**

- **B** — `PORTA VERTE PREMIUM model E.4` ma cztery poziome pasy matowego szkła, a w bazie
  `has_glass=false` (60 rekordów). Chip „bez przeszklenia" pokazuje więc przeszklone drzwi.
- **E** — `PORTA VIGO`, `PORTA CRAFT`, `PORTA VALLO`, `PORTA VERTE HOME model M` to wizualnie
  drzwi rustykalne („ala zbite z desek"), ale ich opisy EN mówią „modern" i „flat panel",
  więc klasyfikator nigdy nie nada im stylu rustykalnego.

Pierwotny pomysł — „jeden przelot wizji naprawi obie rzeczy" — **został obalony
eksperymentalnie** (patrz niżej). Stąd inne rozwiązanie: wizja proponuje, człowiek
rozstrzyga, a decyzja mieszka w wersjonowanej tabeli korekt.

## Ustalenia z badania (dowody, nie przypuszczenia)

### Szkło: packshot nie niesie tej informacji

Wizja **nie została pominięta** przy E.4 — plik postępu poprzedniego backfillu
(`scripts/backfill_glass_progress.json`) zawiera `{"glass": false, "source": "vision"}`.
Model odpowiedział źle. Próby odzyskania sygnału:

| Próba | Wynik |
|---|---|
| Obecny prompt, ścieżka produkcyjna (skalowanie do 1024 px) | `glass: false` |
| Pełna rozdzielczość 935×2000 | `glass: false` |
| Prompt opisowy („opisz każdy element leaf") | widzi „four horizontal dark gray strips", `panes: 0` |
| `gemini-2.5-flash`, `gemini-2.5-pro`, `gpt-4o-mini`, `qwen2.5-vl-72b` | wszystkie `false` |
| Wycinek pasa powiększony 3× | „material: **metal**" (dwa modele niezależnie) |

Oględziny wycinka potwierdzają, że to realnie niejednoznaczne: wąski pas z delikatnym
gradientem, lekko wpuszczony — szyba satynowa i listwa aluminiowa wyglądają tu tak samo.
Feed Porty nie pomoże: pola to wyłącznie `external_id`, `name`, `brand`, `color`,
`category_main`, `description` (= nazwa modelu), `url_product`, `price`, `url_img`,
`url_img_small`, `kolekcja` — **zero informacji o przeszkleniu**.

**Wniosek: szkła dla takich modeli nie da się ustalić maszynowo. Rozstrzyga człowiek.**

### Styl: wizja widzi co innego niż opis — w obie strony

| Model | Z opisu (dziś) | Z wizji |
|---|---|---|
| PORTA VIGO V.3 | nowoczesny, minimalistyczny | **rustykalny**, nowoczesny, skandynawski |
| PORTA CRAFT C.1 | nowoczesny | **rustykalny** („dolny panel z ułożonych pionowo desek") |
| PORTA VALLO V.2 | nowoczesny, minimalistyczny | **rustykalny** |
| NATURA VERDINO V.1 | rustykalny | nowoczesny, skandynawski — **zdejmuje** rustykalny |
| NATURA VECTOR F | nowoczesny, rustykalny | nowoczesny, skandynawski — **zdejmuje** rustykalny |

Kalibracja na 14 losowych modelach: wizja nazywa rustykalnym **21%** katalogu (dziś 3,6%)
i skandynawskim **29%** (dziś 0,2%). Ale bywa też trafniejsza od opisu:
`NATURA CLASSIC model 7.1` to płaskie dębowe skrzydło z bulajem — opis mówi „klasyczny"
tylko dlatego, że kolekcja nazywa się CLASSIC, a wizja słusznie mówi „nowoczesny".

**Wniosek: żadne z dwóch źródeł nie jest autorytetem. Wizja to tani generator hipotez,
arbitrem jest ekspert domenowy.**

## Decyzje (ustalone z użytkownikiem)

1. **Wizja proponuje, użytkownik rozstrzyga, decyzja trafia do wersjonowanej tabeli korekt**
   nakładanej po backfillu i po każdym imporcie — żeby nie ginęła przy następnym sync.
2. **Ziarno korekty: kolekcja z wyjątkami per model.** Jedna linia załatwia jednorodną
   kolekcję; niejednorodna (np. NATURA CLASSIC) dostaje wyjątki dla konkretnych modeli.
3. **Przegląd: statyczna galeria HTML** z packshotami, posortowana od największego
   rozjazdu; decyzje użytkownik podaje w czacie.
4. **Semantyka korekty: pełne zastąpienie, nie doklejanie** — inaczej nie da się ZDJĄĆ
   błędnej metki (np. „klasyczny" z płaskiego skrzydła z bulajem).
5. **Model bije kolekcję** przy konflikcie wpisów.
6. **Korekty szkła mieszkają w tej samej tabeli** — punkt B zamyka się wiedzą użytkownika,
   bez wizji.

## Architektura

### Tabela korekt (`docs/style-overrides.json`)

W repo, wersjonowana, czytelna w diffie:

```json
{
  "kolekcje": {
    "PORTA VIGO":  { "style": ["rustykalny", "nowoczesny"] },
    "PORTA CRAFT": { "style": ["rustykalny"] }
  },
  "modele": {
    "PORTA VERTE PREMIUM model E.4":      { "has_glass": true },
    "NATURA CLASSIC model 7.1 z bulajem": { "style": ["nowoczesny"] }
  }
}
```

Oba pola są opcjonalne: wpis może korygować sam styl, samo szkło albo jedno i drugie.
Rozstrzygnięcia dla przypadków granicznych:

- Pola scalają się **osobno**. Gdy kolekcja koryguje styl, a model tylko `has_glass`,
  model dostaje styl z kolekcji i szkło z własnego wpisu — „model bije kolekcję" działa
  per pole, nie per cały wpis.
- `"style": []` jest dozwolone i znaczy „ten model nie ma stylu" (`style_none`), a nie
  „brak korekty". Brak korekty wyraża się nieobecnością pola.

### Nakładanie (`backend/src/services/overrides.ts` — nowy)

```ts
export interface Korekta { style?: Style[]; hasGlass?: boolean }
export function overrideFor(modelName: string): Korekta | null
export function invalidateOverrides(): void   // do testów
```

- Kolekcja wyliczana z nazwy modelu: `modelName.replace(/\s+model\s+.*$/i, '')` i obcięcie
  dopisków wariantowych (`z …`, `szyba …`, `Bulaj …`) — ta sama reguła co w galerii.
- **Walidacja przy wczytaniu jest głośna**: styl spoza `STYLES`, zły typ pola albo
  niepoprawny JSON → wyjątek z nazwą wpisu. Cicho przepuszczona literówka oznaczałaby
  korektę, która nie działa i nikt tego nie zauważy.
- Plik czytany raz i trzymany w pamięci (wzorzec `styleIndex`).

Wpięcie w trzy miejsca, gdzie dziś powstają flagi — zawsze PO decyzji automatu,
tuż przed zapisem do Chromy:

| Plik | Co koryguje |
|---|---|
| `backend/src/scripts/backfillStyle.ts` | `style_*` całego katalogu |
| `backend/src/services/styleResolver.ts` | `style_*` przy imporcie i sync |
| `backend/src/services/glassResolver.ts` | `has_glass` przy imporcie i sync |

Backfill szkła (`backfillGlass.ts`) korzysta z tych samych helperów co `glassResolver`,
więc korekta obowiązuje też tam.

### Przelot wizji (`backend/src/scripts/visionStylePass.ts` — nowy)

Jedno pytanie o styl na MODEL (reprezentant = pierwszy wariant z `imageUrl`),
`google/gemini-2.5-flash`, współbieżność 4, wznawialny plik postępu
`scripts/vision_style_proposals.json` (gitignored, jak `backfill_glass_progress.json`).

**Skrypt nie zapisuje niczego do ChromaDB** — produkuje wyłącznie propozycje.
Koszt: ~2500 tokenów wejścia × 580 modeli ≈ 1,45 mln tokenów, poniżej 2 zł; ~5 minut.

Prompt wymusza wybór z 7 istniejących stylów, z definicjami po angielsku i instrukcją
„assign a style ONLY if the photo actually shows it". Wyjście: `{"style": [...]}`.

### Galeria przeglądu (`backend/src/scripts/buildStyleReview.ts` — nowy)

Czyta propozycje + aktualne flagi z Chromy, grupuje modele po kolekcji i generuje
`scripts/style-review.html`:

- kafelek na kolekcję: packshot reprezentanta (zdalny URL — strona jest lokalna, więc
  obrazy ładują się wprost z porta.com.pl), nazwa, liczba modeli, metki z opisu,
  propozycja wizji;
- sortowanie **od największego rozjazdu** (liczba stylów różniących opis od wizji,
  ważona liczbą wariantów) — najbardziej sporne na górze;
- gdy modele w kolekcji nie są zgodne co do propozycji wizji, kafelek rozwija listę
  odszczepieńców z ich własnymi miniaturami i metkami.

Strona jest wyłącznie do czytania. Decyzje użytkownik podaje w czacie.

## Testy

**Jednostkowe (`overrides.ts`):**
- wpis modelu bije wpis kolekcji dla tego samego produktu;
- wariant koloru dziedziczy korektę swojego modelu (`… model E.4 - Biały` → wpis dla
  `PORTA VERTE PREMIUM model E.4`);
- brak wpisu → `null` (automat decyduje jak dotąd);
- korekta samego `has_glass` nie rusza stylu i odwrotnie;
- styl spoza `STYLES` → wyjątek z nazwą wpisu;
- niepoprawny JSON → wyjątek, nie ciche `null`.

**Jednostkowe (nakładanie):** `stylesForModel` + korekta → wynik korekty, nie głosowania.

**E2e (po wypełnieniu tabeli i backfillu):**
- „drzwi rustykalne" zwraca VIGO / CRAFT / VALLO;
- `PORTA VERTE PREMIUM model E.4` nie pojawia się przy „bez przeszklenia" i pojawia się
  przy „ze szkłem";
- `checkStyleConsistency.ts` → 0 niespójnych (korekta nie rozjeżdża wariantów modelu);
- ponowne uruchomienie backfillu jest idempotentne (drugi przebieg = 0 zmian).

**Regresja:** backend `vitest` + `tsc`, front `vitest` + build.

## Poza zakresem

- Zmiana taksonomii 7 stylów.
- Wizja do szkła — udowodniono, że nie działa na tych przypadkach.
- Interaktywna strona przeglądu z eksportem JSON (świadomie odrzucona: kod jednorazowy).
- Automatyczne wykrywanie, które kolekcje wymagają korekty w przyszłości — tabela jest
  ręczna z założenia.

## Definicja ukończenia

`overrides.ts` z testami zielony i wpięty w trzy ścieżki; przelot wizji wykonany;
galeria wygenerowana i przejrzana przez użytkownika; `docs/style-overrides.json`
wypełniony jego decyzjami; backfill nałożył korekty; e2e potwierdza VIGO/CRAFT/VALLO
pod „rustykalne" oraz E.4 pod „ze szkłem"; regresja zielona.
Punkt powrotu: `master` @ 2096235.
