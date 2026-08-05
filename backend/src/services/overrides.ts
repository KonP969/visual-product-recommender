// Tabela korekt: co ekspert domenowy WIE o drzwiach, a czego automat nie
// potrafi wyczytać. Powstała, bo dwa przypadki okazały się maszynowo nierozstrzygalne:
// przeszklenie modelu E.4 (cztery wąskie pasy szkła satynowego — cztery różne
// rodziny modeli wizyjnych zgodnie widzą tam "listwę metalową") oraz styl kolekcji
// VIGO/CRAFT/VALLO (opisy EN mówią "modern flat panel", a drzwi wyglądają jak zbite
// z desek). Korekta ZASTĘPUJE decyzję automatu — tylko tak da się zdjąć błędną metkę.
import { readFileSync } from 'fs'
import { join } from 'path'
import { STYLES } from './attributeService'
import type { Style } from './attributeService'

const PLIK = join(__dirname, '..', '..', '..', 'docs', 'style-overrides.json')

export interface Korekta {
  style?: Style[]
  hasGlass?: boolean
}

export interface TabelaKorekt {
  kolekcje: Record<string, Korekta>
  modele: Record<string, Korekta>
}

/** Nazwa modelu → nazwa kolekcji. Obcina człon "model X.Y" i dopiski wariantowe. */
export function kolekcjaOf(modelName: string): string {
  return modelName
    .replace(/[\s,]+model\s+.*$/i, '')
    .replace(/\s+(z\s|szyba|Bulaj)\b.*$/i, '')
    .replace(/[\s,]+$/, '')
    .trim()
}

function czytajWpis(klucz: string, surowy: unknown): Korekta {
  if (typeof surowy !== 'object' || surowy === null || Array.isArray(surowy)) {
    throw new Error(`[OVERRIDES] Wpis "${klucz}" musi być obiektem`)
  }
  const w = surowy as Record<string, unknown>
  const korekta: Korekta = {}

  if ('style' in w) {
    if (!Array.isArray(w.style)) {
      throw new Error(`[OVERRIDES] Wpis "${klucz}": pole "style" musi być tablicą`)
    }
    for (const s of w.style) {
      if (!(STYLES as readonly unknown[]).includes(s)) {
        throw new Error(
          `[OVERRIDES] Wpis "${klucz}": nieznany styl ${JSON.stringify(s)}. Dozwolone: ${STYLES.join(', ')}`,
        )
      }
    }
    korekta.style = w.style as Style[]
  }

  if ('has_glass' in w) {
    if (typeof w.has_glass !== 'boolean') {
      throw new Error(`[OVERRIDES] Wpis "${klucz}": pole "has_glass" musi być true albo false`)
    }
    korekta.hasGlass = w.has_glass
  }

  return korekta
}

export function czytajTabele(surowy: unknown): TabelaKorekt {
  if (typeof surowy !== 'object' || surowy === null || Array.isArray(surowy)) {
    throw new Error('[OVERRIDES] Plik korekt musi zawierać obiekt')
  }
  const t = surowy as Record<string, unknown>
  const wynik: TabelaKorekt = { kolekcje: {}, modele: {} }
  for (const sekcja of ['kolekcje', 'modele'] as const) {
    const dane = t[sekcja]
    if (dane === undefined) continue
    if (typeof dane !== 'object' || dane === null || Array.isArray(dane)) {
      throw new Error(`[OVERRIDES] Sekcja "${sekcja}" musi być obiektem`)
    }
    for (const [klucz, wpis] of Object.entries(dane as Record<string, unknown>)) {
      wynik[sekcja][klucz] = czytajWpis(klucz, wpis)
    }
  }
  return wynik
}

/**
 * Korekta dla produktu (nazwa z wariantem koloru albo bez). Scala wpis kolekcji
 * z wpisem modelu OSOBNO DLA KAŻDEGO POLA: kolekcja może dać styl, a model samo
 * szkło. Zwraca null, gdy nic nie pasuje — wtedy decyduje automat.
 */
export function korektaZTabeli(tabela: TabelaKorekt, productName: string): Korekta | null {
  const model = productName.split(' - ')[0].trim()
  const zKolekcji = tabela.kolekcje[kolekcjaOf(model)]
  const zModelu = tabela.modele[model]
  if (!zKolekcji && !zModelu) return null

  const scalona: Korekta = {}
  if (zModelu?.style !== undefined) scalona.style = zModelu.style
  else if (zKolekcji?.style !== undefined) scalona.style = zKolekcji.style
  if (zModelu?.hasGlass !== undefined) scalona.hasGlass = zModelu.hasGlass
  else if (zKolekcji?.hasGlass !== undefined) scalona.hasGlass = zKolekcji.hasGlass
  return scalona
}

let tabela: TabelaKorekt | null = null

export function invalidateOverrides(): void {
  tabela = null
}

export function overrideFor(productName: string): Korekta | null {
  if (!tabela) {
    tabela = czytajTabele(JSON.parse(readFileSync(PLIK, 'utf-8')))
    const n = Object.keys(tabela.kolekcje).length + Object.keys(tabela.modele).length
    console.log(`[OVERRIDES] Wczytano tabelę korekt: ${n} wpisów`)
  }
  return korektaZTabeli(tabela, productName)
}
