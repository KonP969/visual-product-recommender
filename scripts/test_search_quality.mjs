// Testy jakości wyszukiwania tekstowego — asercje na atrybutach zwróconych
// produktów. Uruchomienie: node scripts/test_search_quality.mjs
// Wymaga działającego stosu (backend 3001 + sidecar + chroma + klucz Gemini).

const BASE = process.env.BACKEND_URL ?? 'http://localhost:3001'

const LIGHT = ['white', 'beige', 'light_wood']
const CASES = [
  {
    query: 'drzwi czarne',
    check: (p) => p.colorFamily === 'black',
    desc: 'wszystkie czarne',
  },
  {
    query: 'pełne, jasne drzwi',
    check: (p) => p.hasGlass === false && LIGHT.includes(p.colorFamily),
    desc: 'bez szkła + jasne',
  },
  {
    query: 'czarne, matowe, nowoczesne drzwi, ale bez przeszklenia',
    check: (p) => p.hasGlass === false && p.colorFamily === 'black',
    desc: 'czarne bez szkła',
  },
  {
    query: 'czarne, matowe drzwi, ale jaśniejsze',
    check: (p) => p.colorFamily !== 'black' && p.colorFamily !== 'dark_wood',
    desc: 'jaśniejsze niż czarne',
  },
  {
    query: 'białe drzwi ze szkłem',
    check: (p) => p.hasGlass === true && p.colorFamily === 'white',
    desc: 'białe + szkło',
  },
  {
    query: 'drzwi w kolorze ciemnego orzecha',
    check: (p) => ['dark_wood', 'medium_wood'].includes(p.colorFamily),
    desc: 'ciemny orzech',
  },
]

async function searchText(query) {
  const res = await fetch(`${BASE}/api/search-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  const events = text.trim().split('\n').map((l) => JSON.parse(l))
  const err = events.find((e) => e.type === 'error')
  if (err) throw new Error(err.error)
  return events.find((e) => e.type === 'result')?.data
}

// Free tier: 10 RPM, a każde wyszukiwanie to 2 wywołania Gemini —
// odstęp między przypadkami trzyma testy pod limitem.
const CASE_DELAY_MS = Number(process.env.CASE_DELAY_MS ?? 14000)

let failed = 0
let first = true
for (const c of CASES) {
  if (!first) await new Promise((r) => setTimeout(r, CASE_DELAY_MS))
  first = false
  try {
    const result = await searchText(c.query)
    const products = result?.products ?? []
    const bad = products.filter((p) => !c.check(p))
    const ok = bad.length === 0 && products.length > 0
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  "${c.query}" (${c.desc}) — ${products.length} wyników`)
    if (bad.length > 0) {
      for (const p of bad.slice(0, 4)) {
        console.log(`      ZŁE: [${p.colorFamily}/glass=${p.hasGlass}] ${p.name.slice(0, 60)}`)
      }
    }
    if (products.length === 0) console.log('      (0 wyników)')
  } catch (e) {
    failed++
    console.log(`FAIL  "${c.query}" — błąd: ${e.message.slice(0, 100)}`)
  }
}

console.log(failed === 0 ? '\nWSZYSTKIE TESTY JAKOŚCI: PASS' : `\nNIEZALICZONE: ${failed}/${CASES.length}`)
process.exit(failed === 0 ? 0 : 1)
