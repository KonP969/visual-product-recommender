// Test twardych filtrów BEZ Gemini: embedding z sidecara + searchSimilar.
// Weryfikuje warstwę danych niezależnie od limitów API.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/testFiltersDirect.ts
import { getTextEmbedding } from '../services/clipService'
import { searchSimilar } from '../services/chromaService'

const LIGHT = ['white', 'beige', 'light_wood']

const CASES: Array<{
  clipQuery: string
  filters: { colors: string[] | null; glass: boolean | null }
  check: (m: { color_family?: string; has_glass?: boolean; name: string }) => boolean
  desc: string
}> = [
  {
    clipQuery: 'black dark matte flat panel modern residential black interior door',
    filters: { colors: ['black'], glass: null },
    check: (m) => m.color_family === 'black',
    desc: 'colors=[black] → wszystkie czarne',
  },
  {
    clipQuery: 'white bright solid flat panel residential white interior door',
    filters: { colors: LIGHT, glass: false },
    check: (m) => m.has_glass === false && LIGHT.includes(m.color_family ?? ''),
    desc: 'jasne + glass=false → zero szyb i bulajów',
  },
  {
    clipQuery: 'white residential interior door with glass insert',
    filters: { colors: ['white'], glass: true },
    check: (m) => m.has_glass === true && m.color_family === 'white',
    desc: 'białe + glass=true',
  },
  {
    clipQuery: 'grey light residential interior door',
    filters: { colors: ['grey', 'light_wood', 'beige', 'white'], glass: null },
    check: (m) => m.color_family !== 'black' && m.color_family !== 'dark_wood',
    desc: '"jaśniejsze niż czarne" → bez czerni i ciemnego drewna',
  },
  {
    clipQuery: 'dark walnut wood grain residential interior door',
    filters: { colors: ['dark_wood'], glass: null },
    check: (m) => m.color_family === 'dark_wood',
    desc: 'ciemny orzech → dark_wood',
  },
]

async function main() {
  let failed = 0
  for (const c of CASES) {
    const embedding = await getTextEmbedding(c.clipQuery)
    const { results } = await searchSimilar(embedding, 10, c.filters)
    const bad = results.filter((r) => !c.check(r.metadata))
    const ok = bad.length === 0 && results.length > 0
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.desc} — ${results.length} wyników`)
    for (const r of bad.slice(0, 4)) {
      console.log(`      ZŁE: [${r.metadata.color_family}/glass=${r.metadata.has_glass}] ${r.metadata.name.slice(0, 60)}`)
    }
  }
  console.log(failed === 0 ? '\nFILTRY: WSZYSTKIE PASS' : `\nNIEZALICZONE: ${failed}/${CASES.length}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
