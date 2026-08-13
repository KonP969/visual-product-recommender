// Przelicza `color_family` + `lightness` na żywo z classifyDoor(name, description)
// dla wszystkich rekordów i aktualizuje te, którym się zmieniła — WYŁĄCZNIE te dwa
// pola. Nie rusza `has_glass`: ten jest częściowo ustalony wizyjnie
// (backfillGlass.ts) i korektami eksperta domenowego (docs/style-overrides.json),
// a classifyDoor().hasGlass zna tylko nazwę — nadpisanie by to skasowało.
// (Dlatego NIE używamy tu backfillAttributes.ts, który nadpisuje wszystkie trzy pola.)
//
// Powód powstania: "Szałwia" nie miała reguły w VARIANT_RULES, więc klasyfikacja
// spadała na opis Gemini, gdzie słowo "black" (opisujące akcent — czarną szybę /
// czarne intarsje, nie płycinę) wygrywało. 8 wariantów miało color_family=black
// mimo zielonego koloru drzwi. Naprawione dodaniem "szałwia" do reguły "grey" w
// attributeService.ts — ten skrypt propaguje poprawkę na już zaimportowane dane.
//
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/backfillColorFamily.ts
import 'dotenv/config'
import { ChromaClient } from 'chromadb'
import { classifyDoor } from '../services/attributeService'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'

async function main() {
  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })

  const updIds: string[] = []
  const updMetas: Record<string, unknown>[] = []
  const flipped: string[] = []
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    r.ids.forEach((id: string, i: number) => {
      const m = r.metadatas[i] as any
      const attrs = classifyDoor(m.name ?? '', m.description ?? '')
      if (m.color_family !== attrs.colorFamily) {
        updIds.push(id)
        updMetas.push({ ...m, color_family: attrs.colorFamily, lightness: attrs.lightness })
        flipped.push(`${m.name} : ${m.color_family ?? '(brak)'} → ${attrs.colorFamily}`)
      }
    })
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  console.log(`[BACKFILL-COLOR] Rekordów do zmiany: ${updIds.length}`)
  flipped.slice(0, 15).forEach((n) => console.log(`  - ${n}`))
  if (flipped.length > 15) console.log(`  ... i ${flipped.length - 15} więcej`)

  for (let i = 0; i < updIds.length; i += 200) {
    await col.update({ ids: updIds.slice(i, i + 200), metadatas: updMetas.slice(i, i + 200) as any })
  }

  console.log('[BACKFILL-COLOR] GOTOWE.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
