// Buduje statyczną galerię do przeglądu: kafelek na kolekcję z packshotem,
// metkami z opisu i propozycją wizji, posortowany od największego rozjazdu.
// Strona jest lokalna, więc obrazy ładują się wprost z porta.com.pl.
// Uruchomienie: cd backend && npx ts-node --transpile-only src/scripts/buildStyleReview.ts
import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ChromaClient } from 'chromadb'
import { STYLES } from '../services/attributeService'
import { categorizeDoor } from '../services/chromaService'
import { modelOf } from '../services/glassResolver'
import { kolekcjaOf } from '../services/overrides'

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const PROPOZYCJE = join(__dirname, '..', '..', '..', 'scripts', 'vision_style_proposals.json')
const WYJSCIE = join(__dirname, '..', '..', '..', 'scripts', 'style-review.html')

/** Liczba stylów, co do których opis i wizja się nie zgadzają (symetryczna różnica). */
export function rozjazd(zOpisu: string[], zWizji: string[]): number {
  const a = new Set(zOpisu)
  const b = new Set(zWizji)
  let n = 0
  for (const s of a) if (!b.has(s)) n++
  for (const s of b) if (!a.has(s)) n++
  return n
}

interface Model {
  model: string
  imageUrl: string
  warianty: number
  zOpisu: string[]
  zWizji: string[]
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function metki(style: string[], klasa: string): string {
  if (style.length === 0) return '<span class="pusto">bez stylu</span>'
  return style.map((s) => `<span class="metka ${klasa}">${esc(s)}</span>`).join(' ')
}

async function main() {
  if (!existsSync(PROPOZYCJE)) {
    throw new Error(`Brak pliku propozycji: ${PROPOZYCJE}. Uruchom najpierw visionStylePass.ts`)
  }
  const propozycje = JSON.parse(readFileSync(PROPOZYCJE, 'utf-8')) as Record<
    string,
    { style: string[] }
  >

  const client = new ChromaClient({ path: CHROMA_URL })
  const col = await client.getCollection({ name: 'products' })
  const modele = new Map<string, Model>()
  let offset = 0
  while (true) {
    const r = await col.get({ limit: 500, offset, include: ['metadatas'] as any })
    if (r.ids.length === 0) break
    for (const m of r.metadatas) {
      const meta = (m ?? {}) as Record<string, unknown>
      const name = String(meta.name ?? '')
      if (categorizeDoor(name) !== 'residential') continue
      const model = modelOf(name)
      const istniejacy = modele.get(model)
      if (istniejacy) {
        istniejacy.warianty++
        continue
      }
      modele.set(model, {
        model,
        imageUrl: String(meta.imageUrl ?? ''),
        warianty: 1,
        zOpisu: STYLES.filter((s) => meta['style_' + s] === true),
        zWizji: propozycje[model]?.style ?? [],
      })
    }
    offset += r.ids.length
    if (r.ids.length < 500) break
  }

  // Grupowanie po kolekcji
  const kolekcje = new Map<string, Model[]>()
  for (const m of modele.values()) {
    const k = kolekcjaOf(m.model)
    if (!kolekcje.has(k)) kolekcje.set(k, [])
    kolekcje.get(k)!.push(m)
  }

  // Waga rozjazdu: suma po modelach, ważona liczbą wariantów — najpierw to,
  // co realnie widać w wynikach wyszukiwania.
  const posortowane = [...kolekcje.entries()]
    .map(([nazwa, lista]) => ({
      nazwa,
      lista,
      waga: lista.reduce((s, m) => s + rozjazd(m.zOpisu, m.zWizji) * m.warianty, 0),
      niejednorodna: new Set(lista.map((m) => [...m.zWizji].sort().join(','))).size > 1,
    }))
    .sort((a, b) => b.waga - a.waga)

  const kafelki = posortowane
    .map(({ nazwa, lista, waga, niejednorodna }) => {
      const rep = lista.find((m) => m.imageUrl) ?? lista[0]
      const warianty = lista.reduce((s, m) => s + m.warianty, 0)
      const odszczepiency = niejednorodna
        ? `<details><summary>modele w tej kolekcji różnią się (${lista.length}) — rozwiń</summary>
             <div class="modele">` +
          lista
            .map(
              (m) => `<div class="model">
                 <img src="${esc(m.imageUrl)}" loading="lazy" alt="">
                 <div><b>${esc(m.model)}</b> · ${m.warianty} war.<br>
                 opis: ${metki(m.zOpisu, 'opis')}<br>
                 wizja: ${metki(m.zWizji, 'wizja')}</div>
               </div>`,
            )
            .join('') +
          `</div></details>`
        : ''
      return `<article class="kafelek">
        <img class="rep" src="${esc(rep.imageUrl)}" loading="lazy" alt="">
        <div class="tresc">
          <h2>${esc(nazwa)}</h2>
          <p class="meta">${lista.length} modeli · ${warianty} wariantów · rozjazd ${waga}</p>
          <p>opis: ${metki(rep.zOpisu, 'opis')}</p>
          <p>wizja: ${metki(rep.zWizji, 'wizja')}</p>
          ${odszczepiency}
        </div>
      </article>`
    })
    .join('\n')

  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<title>Przegląd stylu — ${kolekcje.size} kolekcji</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; background: #faf9f7; color: #1c1a17; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .info { color: #6b655d; margin: 0 0 24px; }
  .kafelek { display: flex; gap: 16px; background: #fff; border: 1px solid #e7e2da; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .rep { width: 90px; height: 200px; object-fit: contain; background: #f4f2ee; border-radius: 8px; flex-shrink: 0; }
  .tresc { flex: 1; min-width: 0; }
  h2 { font-size: 17px; margin: 0 0 2px; }
  .meta { color: #6b655d; font-size: 13px; margin: 0 0 10px; }
  p { margin: 4px 0; }
  .metka { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 13px; }
  .opis { background: #eceae4; }
  .wizja { background: #e5efe6; }
  .pusto { color: #9a938a; font-style: italic; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: #6b655d; font-size: 13px; }
  .modele { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
  .model { display: flex; gap: 8px; align-items: flex-start; width: 340px; font-size: 13px; }
  .model img { width: 46px; height: 100px; object-fit: contain; background: #f4f2ee; border-radius: 6px; }
</style></head>
<body>
<h1>Przegląd stylu — ${kolekcje.size} kolekcji, ${modele.size} modeli</h1>
<p class="info">Posortowane od największego rozjazdu opisu z wizją. „opis" to stan dzisiejszy w bazie, „wizja" to propozycja z packshotu — żadne z nich nie jest jeszcze zapisane jako decyzja.</p>
${kafelki}
</body></html>`

  writeFileSync(WYJSCIE, html, 'utf-8')
  console.log(`[REVIEW] Zapisano ${WYJSCIE}`)
  console.log(`[REVIEW] Kolekcji: ${kolekcje.size}, modeli: ${modele.size}`)
  console.log('[REVIEW] Kolekcje z największym rozjazdem:')
  for (const k of posortowane.slice(0, 12)) {
    console.log(`  ${String(k.waga).padStart(4)}  ${k.nazwa} (${k.lista.length} modeli)`)
  }
}

// Tylko przy uruchomieniu wprost. Test importuje z tego pliku funkcję `rozjazd`,
// a bez tego strażnika sam import odpalałby generowanie galerii (i process.exit
// przy braku pliku propozycji — czyli zabijał runner testów).
if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
