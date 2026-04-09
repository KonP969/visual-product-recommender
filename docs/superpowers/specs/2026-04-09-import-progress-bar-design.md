# Import Progress Bar — Design

**Date:** 2026-04-09  
**Status:** Approved

## Summary

Add a real-time progress bar to the XML import panel using Server-Sent Events (SSE). The backend streams progress events during import; the frontend renders a progress bar with counters and stats.

## Backend

### `POST /api/import` — zmiana na SSE stream

Endpoint przestaje zwracać natychmiastową odpowiedź JSON. Zamiast tego:
- Ustawia nagłówki `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Czeka na sparsowanie XML, następnie strumieniuje zdarzenia przez cały czas trwania importu
- Import nie jest już fire-and-forget — trwa przez czas połączenia

Jeśli klient rozłączy się w trakcie, import kontynuuje w tle (current behavior preserved via `req.on('close', ...)`).

### Typy zdarzeń SSE

```
data: {"type":"progress","current":387,"total":2000,"success":1,"skipped":386,"failed":0}

data: {"type":"done","total":2000,"success":14,"skipped":386,"failed":0}

data: {"type":"error","message":"Feed parse failed: ..."}
```

### `importService.ts` — dodanie callbacku postępu

Sygnatura `runImport` rozszerzona o opcjonalny `onProgress` callback:

```ts
export interface ImportProgress {
  current: number
  total: number
  success: number
  skipped: number
  failed: number
}

export async function runImport(
  source: string,
  options: ImportOptions & { onProgress?: (p: ImportProgress) => void } = {}
): Promise<ImportProgress>
```

Callback wywoływany po każdym produkcie. Funkcja zwraca finalny `ImportProgress`.

## Frontend

### `ImportPanel.tsx` — streaming fetch zamiast zwykłego fetch

Używamy `fetch` z `ReadableStream` (nie `EventSource` — bo potrzebujemy POST z body).

Stany komponentu:
- `idle` — formularz (bez zmian)
- `loading` — spinner "Pobieranie i parsowanie XML…" (przed pierwszym zdarzeniem `progress`)
- `importing` — pasek postępu + statystyki na żywo
- `success` — podsumowanie końcowe (zielone)
- `error` — komunikat błędu (czerwone)

### Widok stanu `importing`

```
Importowanie produktów…
[████████████░░░░░░░░░░] 42%

387 / 2000 produktów
✓ Nowe: 14   ↷ Pominięte: 370   ✗ Błędy: 3
```

Pasek i liczniki aktualizują się z każdym zdarzeniem SSE.

### Obsługa strumienia

```ts
const response = await fetch('/api/import', { method: 'POST', ... })
const reader = response.body!.getReader()
const decoder = new TextDecoder()

// Buforowanie fragmentów i parsowanie linii "data: {...}"
```

Każda linia `data: {...}` parsowana jako JSON i mapowana na stan komponentu.

## Pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `backend/src/routes/import.ts` | SSE zamiast JSON response |
| `backend/src/services/importService.ts` | Dodanie `onProgress` callback + return value |
| `frontend/src/components/ImportPanel.tsx` | Streaming fetch + progress bar UI |

## Pliki bez zmian

- `feedParser.ts`, `chromaService.ts`, `clipService.ts`, `imageDownloader.ts` — bez zmian
