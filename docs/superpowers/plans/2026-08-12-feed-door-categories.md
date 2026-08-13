# Kategorie drzwi z feedu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wyeliminować z katalogu 1771 wariantów drzwi wejściowych/technicznych/przesuwnych/składanych, które trafiły tam bo `isDoorProduct` odsiewał po `category_main` tylko klamki/akcesoria/ościeżnice, a wszystko inne domyślnie uznawał za drzwi wewnętrzne.

**Architecture:** `category_main` z feedu już jest parsowane (`feedParser.ts`) i już odsiewa część kategorii w `isDoorProduct` (`chromaService.ts`) — używane przy imporcie (`importService.ts`, `syncCatalog.ts`) i przy czyszczeniu istniejącego katalogu (`purgeNonDoors.ts`, już istnieje, nieużywany od poprzedniej naprawy). Cała zmiana to rozszerzenie jednej listy odsiewu (`NON_DOOR_CATEGORIES`) o 4 nowe kategorie, ponowne uruchomienie istniejącego skryptu czyszczącego katalog, i usunięcie martwych wpisów w tabeli korekt.

**Tech Stack:** TypeScript, Vitest, ChromaDB (Python sidecar/serwer lokalny), ts-node.

## Global Constraints

- Decyzje eksperta domenowego z `docs/otwarte-zadania.md` §1 są ostateczne — nie renegocjować zakresu: USUNĄĆ wejściowe/techniczne/przesuwne/składane, ZOSTAWIĆ szklane/Loft Steel/brak kategorii.
- `isDoorProduct` pozostaje jedynym źródłem prawdy o typie drzwi — zero zgadywania z nazwy dla tego rozstrzygnięcia (`docs/otwarte-zadania.md` sekcja "Czego NIE próbować ponownie").
- Każdą naprawę weryfikować samodzielnie, łącznie z przejściem przez UI Playwrightem, zanim praca zostanie oddana do przeklikania (instrukcja eksperta domenowego z poprzedniej sesji).
- Backend trzyma liczniki chipów stylu w pamięci procesu — po każdej zmianie danych w ChromaDB (purge, import) restart backendu (`touch backend/src/index.ts` przy `npm run dev`, albo pełny restart procesu).

---

### Task 1: Rozszerzyć odsiew kategorii nie-drzwiowych

**Files:**
- Modify: `backend/src/services/chromaService.ts:75-89` (`NON_DOOR_CATEGORIES`, komentarz nad nią)
- Modify: `backend/src/services/importService.ts:46` (kosmetyka logu — lista kategorii w nawiasie jest już nieaktualna)
- Test: `backend/src/services/__tests__/chromaService.test.ts:47-57`

**Interfaces:**
- Consumes: nic nowego — `isDoorProduct(categoryMain?: string | null): boolean` już istnieje i jest już wywoływane w `importService.ts`, `syncCatalog.ts`, `purgeNonDoors.ts`.
- Produces: te same trzy miejsca dostają bez zmian w sygnaturze inny wynik dla 4 nowych wartości `categoryMain`.

- [ ] **Step 1: Zaktualizować test tak, żeby czterokrotnie failował**

W `backend/src/services/__tests__/chromaService.test.ts` przenieś cztery kategorie z bloku "→ drzwi" do nowego bloku "→ nie jest drzwiami":

```typescript
describe('isDoorProduct — odsiew nie-drzwi z feedu', () => {
  it.each([
    ['Klamki', false],
    ['Akcesoria', false],
    ['Ościeżnice', false],
    ['Drzwi wejściowe do mieszkania', false],
    ['Drzwi techniczne', false],
    ['Drzwi przesuwne', false],
    ['Drzwi składane', false],
  ])('kategoria "%s" → nie jest drzwiami', (cat, expected) => {
    expect(isDoorProduct(cat)).toBe(expected)
  })

  it.each([
    ['Drzwi wewnętrzne'],
    ['Drzwi szklane'],
    ['Porta Loft Steel'],
  ])('kategoria "%s" → drzwi', (cat) => {
    expect(isDoorProduct(cat)).toBe(true)
  })

  // 379 realnych drzwi w feedzie nie ma category_main (PORTA UNI KOLOR MODERN,
  // CLASSIC C.2, KWARC …) — brak kategorii NIE MOŻE ich odsiewać.
  it.each([undefined, null, ''])('brak kategorii (%s) → drzwi (nie odsiewamy)', (cat) => {
    expect(isDoorProduct(cat)).toBe(true)
  })

  it('nie jest wrażliwa na wielkość liter i białe znaki', () => {
    expect(isDoorProduct('  klamki  ')).toBe(false)
    expect(isDoorProduct('AKCESORIA')).toBe(false)
  })
})
```

- [ ] **Step 2: Uruchomić testy i potwierdzić 4 fails**

Run: `cd backend && npx vitest run src/services/__tests__/chromaService.test.ts`
Expected: 4 FAIL na kategoriach "Drzwi wejściowe do mieszkania", "Drzwi techniczne", "Drzwi przesuwne", "Drzwi składane" (dostają `true` zamiast oczekiwanego `false`).

- [ ] **Step 3: Rozszerzyć `NON_DOOR_CATEGORIES` i zaktualizować komentarz**

W `backend/src/services/chromaService.ts` zamień:

```typescript
// Kategorie feedu, które nie są skrzydłem drzwiowym: klamki, wizjery, zawiasy,
// ościeżnice. Bez tego trafiają do katalogu jako drzwi — bo categorizeDoor to
// denylista i wszystko nierozpoznane domyślnie zostaje 'residential'.
const NON_DOOR_CATEGORIES = new Set(['klamki', 'akcesoria', 'ościeżnice'])
```

na:

```typescript
// Kategorie feedu, które NIE są drzwiami wewnętrznymi: klamki/akcesoria/
// ościeżnice (to nie skrzydło drzwiowe) oraz — decyzja eksperta domenowego,
// docs/otwarte-zadania.md §1 — drzwi wejściowe, techniczne, przesuwne i
// składane (to skrzydła, ale nie do wnętrza mieszkania). Bez tego trafiają
// do katalogu jako drzwi — bo categorizeDoor to denylista po NAZWIE i
// wszystko nierozpoznane domyślnie zostaje 'residential'.
const NON_DOOR_CATEGORIES = new Set([
  'klamki',
  'akcesoria',
  'ościeżnice',
  'drzwi wejściowe do mieszkania',
  'drzwi techniczne',
  'drzwi przesuwne',
  'drzwi składane',
])
```

- [ ] **Step 4: Uruchomić testy i potwierdzić PASS**

Run: `cd backend && npx vitest run src/services/__tests__/chromaService.test.ts`
Expected: PASS (wszystkie `isDoorProduct` case'y, w tym 3 nowe kategorie "→ drzwi" i 4 przeniesione "→ nie jest drzwiami").

- [ ] **Step 5: Odświeżyć nieaktualny komentarz w logu importu**

W `backend/src/services/importService.ts:46` zamień:

```typescript
    (dropped > 0 ? ` — odsiano ${dropped} nie-drzwi (klamki/akcesoria/ościeżnice)` : ''),
```

na:

```typescript
    (dropped > 0 ? ` — odsiano ${dropped} nie-drzwi z feedu` : ''),
```

(Nie jest to pokryte testem — sam string w konsoli. Ogólniejszy opis, bo lista kategorii już ma 7 pozycji i będzie rosła.)

- [ ] **Step 6: Pełny przebieg testów backendu + typecheck**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: wszystkie testy PASS (bazowo 199, teraz 199 bo tylko przeniesione case'y, nie nowe testy netto — sprawdź faktyczną liczbę w outpucie), `tsc` bez wyjścia.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/chromaService.ts backend/src/services/importService.ts backend/src/services/__tests__/chromaService.test.ts
git commit -m "fix(feed): odsiewaj drzwi wejściowe, techniczne, przesuwne i składane po category_main"
```

---

### Task 2: Wyczyścić istniejący katalog z już zaimportowanych nie-drzwi

**Files:**
- Use (bez zmian w kodzie): `backend/src/scripts/purgeNonDoors.ts` — już istnieje z poprzedniej naprawy (klamki/akcesoria/ościeżnice), teraz odetnie też 4 nowe kategorie bo korzysta z `isDoorProduct` zmienionego w Task 1.

**Interfaces:**
- Consumes: `isDoorProduct` z Task 1 (rozszerzony denylist), `parseFeedStreaming` z `feedParser.ts` (bez zmian).
- Produces: nic dla kolejnych tasków w kodzie — efekt to stan ChromaDB (usunięte rekordy).

- [ ] **Step 1: Upewnić się, że wszystkie 4 serwery działają**

Run: `curl -s http://localhost:3001/api/health`
Expected: JSON z trzema `true` (chroma, sidecar, backend). Jeśli nie — uruchom `powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1` z katalogu głównego repo i poczekaj na model CLIP (~30s przy zimnym starcie).

- [ ] **Step 2: Dry-run czyszczenia — policzyć, co zniknie**

Run: `cd backend && DRY_RUN=1 npx ts-node --transpile-only src/scripts/purgeNonDoors.ts`
Expected: log z podziałem na kategorie, w tym linie dla `Drzwi wejściowe do mieszkania`, `Drzwi techniczne`, `Drzwi przesuwne`, `Drzwi składane`. Zanotuj liczbę "do usunięcia" — porównaj rząd wielkości z `docs/otwarte-zadania.md` §1 (1425+187+89+70 = 1771 wariantów w feedzie; w bazie może być mniej, bo nie wszystko z feedu zostało kiedyś zaimportowane).

- [ ] **Step 3: Realne czyszczenie**

Run: `cd backend && npx ts-node --transpile-only src/scripts/purgeNonDoors.ts`
Expected: log `[PURGE] GOTOWE. <before> → <after> (usunięto <N>).` gdzie `<N>` odpowiada liczbie z kroku 2.

- [ ] **Step 4: Zweryfikować, że AGAT i OPAL zniknęły**

Run:
```bash
curl -s -X POST http://localhost:3001/api/search-by-name -H "Content-Type: application/json" -d "{\"query\": \"AGAT\"}"
```
(jeśli endpoint ma inną nazwę — sprawdzić `backend/src/routes` przed uruchomieniem; alternatywnie zapytać przez UI wyszukiwarki tekstowej, jeśli istnieje, albo policzyć bezpośrednio w Chroma przez mały skrypt ad-hoc w scratchpadzie)
Expected: brak wyników dla modeli AGAT P.1/P.3 i OPAL P.1/P.3 — to były drzwi wejściowe.

- [ ] **Step 5: Restart backendu (liczniki chipów w pamięci)**

Run: dotknij `backend/src/index.ts` (np. `Get-Item` + `Set-Content` z tą samą treścią, albo zapisz plik bez zmian w edytorze) żeby `npm run dev` (ts-node-dev / nodemon) się zrestartował. Sprawdź w logu terminala backendu, że proces faktycznie się zrestartował.

- [ ] **Step 6: Sprawdzić spójność stylów po usunięciu**

Run: `cd backend && npx ts-node --transpile-only src/scripts/checkStyleConsistency.ts`
Expected: `niespójnych: 0`. Liczby per styl będą niższe niż w poprzedniej sesji (rustykalny miał 339 licząc też usunięte modele — jeśli żaden z usuniętych nie był rustykalny, zostanie 339; jeśli usunięcie AGAT/OPAL/etc. zabrało jakieś rekordy stylu, liczba spadnie proporcjonalnie). Zanotuj nowe liczby do raportu końcowego.

---

### Task 3: Sprzątnąć martwe wpisy w tabeli korekt i zweryfikować całość w UI

**Files:**
- Modify: `docs/style-overrides.json:11-12` (usunąć dwa martwe wpisy kolekcji)
- Test: `cd backend && npx vitest run` (cała suita — `styleResolver.test.ts` czyta ten plik)

**Interfaces:**
- Consumes: stan ChromaDB po Task 2 (drzwi przesuwne usunięte z katalogu).
- Produces: nic dla dalszych tasków — to ostatni task planu.

- [ ] **Step 1: Usunąć martwe wpisy `System przesuwny BLACK` / `System Przesuwny BLACK`**

W `docs/style-overrides.json` zamień:

```json
    "NATURA VECTOR": { "style": ["rustykalny"] },
    "System przesuwny BLACK": { "style": ["rustykalny"] },
    "System Przesuwny BLACK": { "style": ["rustykalny"] }
  },
```

na:

```json
    "NATURA VECTOR": { "style": ["rustykalny"] }
  },
```

- [ ] **Step 2: Sprawdzić, że `applyOverrides.ts` nadal jest idempotentny**

Run: `cd backend && npx ts-node --transpile-only src/scripts/applyOverrides.ts`
Expected: `rekordów do zmiany: 0` — bo wpisy dotyczyły produktów, które i tak już nie istnieją w katalogu po Task 2.

- [ ] **Step 3: Pełna suita testów backendu i frontendu**

Run:
```bash
cd backend && npx vitest run && npx tsc --noEmit
cd ../frontend && npx vitest run && npm run build
```
Expected: backend PASS + czysty `tsc`; frontend PASS + zielony build.

- [ ] **Step 4: Health check**

Run: `curl -s http://localhost:3001/api/health`
Expected: trzy `true`.

- [ ] **Step 5: Weryfikacja w przeglądarce przez Playwright**

Cel: potwierdzić, że filtr „bez przeszklenia" nie pokazuje już drzwi wejściowych (AGAT/OPAL), i że liczba wariantów na chipach stylu spadła zgodnie z oczekiwaniem z Task 2 Step 6.

Kroki (użyj Chrome/Playwright automation, ścieżka użytkownika z poprzedniej sesji: przykładowe wnętrze → wyszukiwanie → chip „bez przeszklenia"):
1. Otwórz `http://localhost:5173`.
2. Wgraj przykładowe zdjęcie wnętrza (jak w poprzedniej sesji — patrz `check-glass.js` w starym scratchpadzie jako referencja kroków, jeśli trzeba odtworzyć selektor).
3. Zaznacz chip „bez przeszklenia".
4. Sprawdź wyniki: żaden wynik nie powinien mieć nazwy zawierającej AGAT ani OPAL (to były jedyne modele wejściowe z `has_glass=true` mylnie liczone jako wnętrzowe).
5. Zrób zrzut ekranu / zapisz plik potwierdzający.

Expected: brak AGAT/OPAL w wynikach niezależnie od stanu chipa szkła (bo ich już nie ma w katalogu), a chip „bez przeszklenia" pokazuje wyłącznie warianty z `has_glass=false` spośród pozostałych modeli.

- [ ] **Step 6: Commit**

```bash
git add docs/style-overrides.json
git commit -m "chore(overrides): usuń martwe wpisy System przesuwny BLACK po odsianiu drzwi przesuwnych"
```

---

## Self-Review Notes

- **Pokrycie specyfikacji:** Task 1 realizuje tabelę decyzji z `docs/otwarte-zadania.md` §1 (4 kategorie USUNĄĆ, 3 ZOSTAWIĆ w tym brak-kategorii). Task 2 realizuje faktyczne usunięcie z istniejącego katalogu (nie tylko blokadę przyszłych importów). Task 3 realizuje wprost wskazaną w §1 "Konsekwencję dla tabeli korekt". Nie dotyka §2 (skandynawski) ani §3 (resztki szkła) — to osobne punkty listy, celowo poza zakresem tego planu.
- **Store `category_main` w metadanych ChromaDB:** rozważone i odrzucone (YAGNI) — `isDoorProduct` już działa wyłącznie na świeżo sparsowanym feedzie w trzech miejscach (`importService.ts`, `syncCatalog.ts`, `purgeNonDoors.ts`), żadne z nich nie potrzebuje wartości z przeszłości. Gdyby w przyszłości potrzebny był raport "jakie kategorie ma katalog" bez re-parsowania feedu — to osobne zadanie, nie blokuje decyzji z §1.
- **Placeholder scan:** brak "TODO"/"handle edge cases" — każdy krok ma konkretną komendę i oczekiwany wynik.
