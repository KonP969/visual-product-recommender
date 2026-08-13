// Structured attributes extracted from product name + generated description.
// These power hard `where` filters in ChromaDB — vector similarity alone can't
// do negation ("no glass") or guarantee a colour, so we don't ask it to.

export const COLOR_FAMILIES = [
  'white',
  'black',
  'grey',
  'beige',
  'light_wood',
  'medium_wood',
  'dark_wood',
] as const

export type ColorFamily = (typeof COLOR_FAMILIES)[number]

export interface DoorAttributes {
  colorFamily: ColorFamily | 'unknown'
  hasGlass: boolean
  /** 1 = najciemniejsze (czerń), 5 = najjaśniejsze (biel) */
  lightness: number
  styles: Style[]
}

export const LIGHTNESS: Record<ColorFamily, number> = {
  white: 5,
  beige: 4.3,
  light_wood: 4,
  grey: 3,
  medium_wood: 3,
  dark_wood: 2,
  black: 1,
}

export const GLASS_RE = /szyb|bulaj|przeszkl|witryn|glass|szpros|frosted|glazed/i
// Nazwa jawnie deklarująca brak szkła — wtedy ufamy nazwie, nie wizji.
export const SOLID_NAME_RE = /pe[łl]ne/i

export const STYLES = [
  'klasyczny',
  'nowoczesny',
  'minimalistyczny',
  'rustykalny',
  'loft',
  'skandynawski',
  'glamour',
] as const
export type Style = (typeof STYLES)[number]

// Styl czytamy z angielskiego opisu (już w metadanych) — nie z nazwy ani wizji.
// Multi-label: drzwi dostają KAŻDY styl, którego sygnał pojawia się w opisie,
// więc nie zmuszamy ich do jednego arbitralnego kubełka (mniejsze ryzyko przy
// twardym filtrze). Słowa-nastroje ("elegant") i konstrukcja ("flat panel")
// świadomie POMINIĘTE — to nie style.
const STYLE_SIGNALS: Array<[Style, RegExp]> = [
  ['klasyczny', /\bclassic|traditional|raised[ -]?panel/i],
  ['nowoczesny', /\bmodern|contemporary/i],
  ['minimalistyczny', /minimalist/i],
  ['rustykalny', /rustic|farmhouse|knotty/i],
  ['loft', /\bloft|industrial/i],
  ['skandynawski', /scandinav|nordic/i],
  ['glamour', /glamou?r|luxur|ornate|baroque|ozdobn/i],
]

// docs/otwarte-zadania.md §2: opisy Gemini prawie nigdy nie mówią wprost
// "scandinavian"/"nordic" (stąd /scandinav|nordic/i wyżej prawie nigdy nie trafia).
// Sygnał z prompta wizji (visionStylePass.ts): "pale wood AND deliberately light,
// airy, simple — not merely light coloured". Jasne drewno = ta sama rodzina koloru
// co reszta klasyfikacji (light_wood); świadoma prostota = to samo słowo co
// minimalistyczny. Wymagamy OBU, żeby nie łapać każdych jasnych drzwi — sam kolor
// bez prostoty (np. "warm elegant") to za mało.
export function classifyStyles(description: string, colorFamily?: ColorFamily | null): Style[] {
  const trafione = new Set<Style>(
    STYLE_SIGNALS.filter(([, re]) => re.test(description)).map(([s]) => s),
  )
  if (colorFamily === 'light_wood' && trafione.has('minimalistyczny')) {
    trafione.add('skandynawski')
  }
  return STYLES.filter((s) => trafione.has(s))
}

// Flagi boolean do metadanych Chromy (multi-label nie mieści się w skalarze).
// style_none = true, gdy opis nie dał żadnego stylu — te drzwi filtr stylu
// NIGDY nie odcina (zabezpieczenie: patrz buildWhere).
export function styleFlags(styles: Style[]): Record<string, boolean> {
  const flags: Record<string, boolean> = {}
  for (const s of STYLES) flags['style_' + s] = styles.includes(s)
  flags['style_none'] = styles.length === 0
  return flags
}

// Styl to cecha MODELU, nie wariantu koloru: opisy wariantów tego samego modelu
// bywają sprzeczne ("modern" vs "modern, adding a rustic touch"), bo styl przykleja
// się do wybarwienia. Głosujemy: styl z większością głosów wygrywa. Gdy nikt nie ma
// większości, bierzemy lidera — dzięki temu model nie wpada do style_none, którego
// filtr nigdy nie chowa (a więc pokazywałby się pod KAŻDYM chipem stylu).
export function aggregateStyles(perVariant: Style[][]): Style[] {
  if (perVariant.length === 0) return []
  const głosy = new Map<Style, number>()
  for (const style of perVariant) {
    for (const s of style) głosy.set(s, (głosy.get(s) ?? 0) + 1)
  }
  if (głosy.size === 0) return []

  // Iterujemy po STYLES, żeby kolejność wyniku była kanoniczna (stabilne testy
  // i stabilne metadane), niezależna od kolejności wstawiania do mapy.
  const większość = STYLES.filter((s) => (głosy.get(s) ?? 0) * 2 > perVariant.length)
  if (większość.length > 0) return [...większość]

  const max = Math.max(...głosy.values())
  return STYLES.filter((s) => (głosy.get(s) ?? 0) === max)
}

// Jawnie nazwany POJEDYNCZY styl w tekście → enum. Zero lub wiele → null
// (wtedy ufamy LLM-owi). Bliźniak explicitColorFromQuery.
const EXPLICIT_STYLE_TERMS: Array<[RegExp, Style]> = [
  [/klasyczn|\bclassic/i, 'klasyczny'],
  [/nowoczesn|\bmodern\w*/i, 'nowoczesny'],
  [/minimalist/i, 'minimalistyczny'],
  [/rustykaln|rustic/i, 'rustykalny'],
  [/\bloft\w*|industrial/i, 'loft'],
  [/skandynawsk|scandinav|nordyck/i, 'skandynawski'],
  [/glamou?r|glamur/i, 'glamour'],
]

export function explicitStyleFromQuery(query: string): Style | null {
  const found = new Set<Style>()
  for (const [re, s] of EXPLICIT_STYLE_TERMS) if (re.test(query)) found.add(s)
  return found.size === 1 ? [...found][0] : null
}

// Kolejność ma znaczenie: pierwsza pasująca reguła wygrywa.
// Wariant polski (część nazwy po " - ") np. "Dąb Matowy Ciemny", "Czarny Struktura".
const VARIANT_RULES: Array<[RegExp, ColorFamily]> = [
  [/czarn/i, 'black'],
  [/wenge\s*white/i, 'light_wood'],
  [/wenge|heban/i, 'dark_wood'],
  [/biał|bialy/i, 'white'],
  [/antracyt|grafit|popiel|szar|fiord|przykurzon|szałwia|szalwia/i, 'grey'],
  [/kaszmir|beż|bez\b|piaskow|krem|wanili|oliwk/i, 'beige'],
  [/ciemn|brunatn|czekolad|bagienn|marone|mocca|tabak|tabacco|hawana|szkarłatn/i, 'dark_wood'],
  [/orzech/i, 'medium_wood'],
  [/jasn|bielon|złot|zloty|miodow|srebrn|sonoma/i, 'light_wood'],
  [/naturaln/i, 'light_wood'],
  [/dąb|dab|orzech|akacja|hikora|halifax|jesion|winchester|vicenza|catania|lorenzo|kendal|craft|salvador|casella|arles|sherman|kalifornia|bookmatch|mauvella|toffee/i, 'medium_wood'],
]

// Fallback: kolor z angielskiego opisu wygenerowanego przez Gemini.
const DESCRIPTION_RULES: Array<[RegExp, ColorFamily]> = [
  [/\bblack\b/i, 'black'],
  [/\bwhite\b/i, 'white'],
  [/light\s+(oak|wood|hickory|ash|acacia)|natural\s+wood|bleached/i, 'light_wood'],
  [/dark\s+(oak|walnut|wood|hickory)|walnut|wenge|espresso|chocolate/i, 'dark_wood'],
  [/gr[ae]y|anthracite|graphite|charcoal/i, 'grey'],
  [/beige|cashmere|cream|sand|taupe|champagne/i, 'beige'],
  [/\boak\b|wood\s+(grain|veneer)|acacia|hickory/i, 'medium_wood'],
]

function classifyVariant(variant: string): ColorFamily | null {
  for (const [re, family] of VARIANT_RULES) {
    if (re.test(variant)) return family
  }
  return null
}

function classifyDescription(description: string): ColorFamily | null {
  // Kolor stoi na początku opisu (tak każe prompt reindexu) — ale skanujemy
  // pierwsze ~80 znaków, żeby nie łapać koloru okuć z końcówki.
  const head = description.slice(0, 80)
  for (const [re, family] of DESCRIPTION_RULES) {
    if (re.test(head)) return family
  }
  return null
}

// Jawne polskie/angielskie nazwy kolorów → rodzina. Kolejność: dłuższe/bardziej
// szczegółowe frazy przed ogólnymi, żeby "ciemny orzech" wygrało z "orzech".
const EXPLICIT_COLOR_TERMS: Array<[RegExp, ColorFamily]> = [
  [/\bczar\w*|\bblack\b|\bheban\w*/i, 'black'],
  [/\bbiał\w*|\bbial\w*|\bwhite\b/i, 'white'],
  [/\bszar\w*|\bgrey\b|\bgray\b|\bantracyt\w*|\bgrafit\w*|\bpopiel\w*/i, 'grey'],
  [/\bbeż\w*|\bbez\w*\bkolor|\bkaszmir\w*|\bkrem\w*|\bcappuccino|\bbeige\b/i, 'beige'],
  [/ciemn\w*\s+(orzech|dąb|dab|drewn|brąz|braz)\w*|\bwenge\b|\bciemnobr[aą]z\w*/i, 'dark_wood'],
  [/jasn\w*\s+(orzech|dąb|dab|drewn|brąz|braz)\w*|\bjasnobr[aą]z\w*/i, 'light_wood'],
]

// Słowa oznaczające korektę względną lub zakres — wtedy NIE narzucamy koloru,
// bo intencją nie jest konkretna rodzina ("czarne, ale jaśniejsze" = NIE czarne).
const RELATIVE_OR_VAGUE_RE =
  /jaśniej\w*|jasniej\w*|ciemniej\w*|lighter|darker|jasne\b|ciemne\b|light\b|dark\b|drewniane\b|wooden\b/i

/**
 * Twardy, deterministyczny kolor z tekstu zapytania — gdy użytkownik jawnie
 * nazwał JEDEN kolor i nie użył modyfikatora względnego/zakresowego.
 * Zwraca null, gdy nie da się jednoznacznie ustalić (wtedy ufamy LLM-owi).
 */
export function explicitColorFromQuery(query: string): ColorFamily[] | null {
  if (RELATIVE_OR_VAGUE_RE.test(query)) return null
  const found = new Set<ColorFamily>()
  for (const [re, family] of EXPLICIT_COLOR_TERMS) {
    if (re.test(query)) found.add(family)
  }
  // Tylko jednoznaczne, pojedyncze wskazanie koloru — wielokolorowe/zerowe → LLM
  return found.size === 1 ? [...found] : null
}

// Wszystkie rodziny drewna — intencja "chcę drewno" nie wskazuje odcienia.
export const WOOD_FAMILIES: ColorFamily[] = ['light_wood', 'medium_wood', 'dark_wood']

// Gatunki i określenia drewna BEZ wskazania odcienia. Intencją jest usłojenie,
// nie konkretna rodzina — dlatego wymuszamy całą paletę drewna.
const WOOD_TERMS_RE =
  /\bd[ęe]b\w*|\borzech\w*|\bjesion\w*|\bakacj\w*|\bsosn\w*|\bbuk\w*|\bdrewn\w*|\bfornir\w*|\bwood\w*|\boak\b|\bwalnut\b/i

// Tylko korekty jasności — węższe niż RELATIVE_OR_VAGUE_RE, bo "drewniane"
// samo w sobie JEST teraz twardą intencją, a nie mgłą.
const RELATIVE_LIGHTNESS_RE = /jaśniej\w*|jasniej\w*|ciemniej\w*|lighter|darker/i

/**
 * Twarda intencja materiału: użytkownik poprosił o drewno, nie nazywając odcienia.
 * Zwraca całą paletę drewna, żeby kolor z zamrożonej bazy (np. "białe" z opisu
 * wnętrza) nie przykrył prośby o usłojenie. Gdy odcień JEST nazwany
 * ("ciemny orzech"), pierwszeństwo ma explicitColorFromQuery — patrz search.ts.
 */
export function explicitWoodFromQuery(query: string): ColorFamily[] | null {
  if (RELATIVE_LIGHTNESS_RE.test(query)) return null
  return WOOD_TERMS_RE.test(query) ? [...WOOD_FAMILIES] : null
}

// Gatunek drewna nazwany wprost. Rodzina koloru tu nie wystarcza: "Orzech
// Ciemny" i "Dąb Ciemny" to oba dark_wood, a klient prosił o orzech.
// Klucz → [wzorzec w zapytaniu, wzorzec w nazwie wariantu].
const FINISH_TERMS: Array<[string, RegExp, RegExp]> = [
  ['orzech', /\borzech\w*|\bwalnut\b/i, /orzech/i],
  ['dab', /\bd[ęe]b\w*|\bd[ąa]b\w*|\boak\b/i, /d[ąa]b|d[ęe]b/i],
  ['jesion', /\bjesion\w*|\bash\b/i, /jesion/i],
  ['akacja', /\bakacj\w*|\bacacia\b/i, /akacj/i],
  ['sosna', /\bsosn\w*|\bpine\b/i, /sosn/i],
  ['buk', /\bbuk\w*|\bbeech\b/i, /\bbuk/i],
  ['wenge', /\bwenge\b/i, /wenge/i],
  ['hikora', /\bhikor\w*/i, /hikor/i],
]

/**
 * Konkretny gatunek wybarwienia nazwany w zapytaniu ("orzech", "dębowe").
 * Zwraca null, gdy user prosi o drewno ogólnie ("drewno naturalne") — wtedy
 * zawężamy tylko do rodzin drewna, bez wskazywania gatunku.
 */
export function explicitFinishFromQuery(query: string): string | null {
  const found = FINISH_TERMS.filter(([, queryRe]) => queryRe.test(query))
  // Wiele gatunków naraz → nie zgadujemy, który jest wiodący.
  return found.length === 1 ? found[0][0] : null
}

/** Czy nazwa produktu (wraz z wariantem) należy do wskazanego wybarwienia? */
export function finishMatches(productName: string, finish: string): boolean {
  const entry = FINISH_TERMS.find(([key]) => key === finish)
  return entry ? entry[2].test(productName) : true
}

// Rzeczowniki oznaczające DETAL drzwi — kolor stojący przy nich opisuje ten
// detal, nie skrzydło ("czarne szkło" na szarych drzwiach jest poprawne).
const DETAIL_NOUN_RE = /szk[łl]|szyb|intarsj|wstawk|okuc|klamk|uchwyt|zawias|listw|ram[ake]/i

// Konkretne nazwy kolorów/wybarwień. Modyfikatory względne ("jasny"/"ciemny")
// świadomie POMINIĘTE — są relatywne, a ich blokowanie kasowałoby sensowne zdania.
const COLOR_WORD_STEMS: RegExp[] = [
  /biał|bial/i, /czarn/i, /szar/i, /grafit/i, /antracyt/i, /popiel/i,
  /beż|bez\b/i, /kaszmir/i, /krem/i, /wanili/i, /oliwk/i,
  /brąz|braz/i, /orzech/i, /dąb|dab|dęb|deb/i, /jesion/i, /akacj/i,
  /wenge/i, /heban/i, /srebrn/i, /złot|zlot/i, /miodow/i, /piaskow/i,
  /sonoma|fiord|toffee|hawana|mocca|czekolad/i,
]

/**
 * Czy uzasadnienie przypisuje SKRZYDŁU nazwę koloru, której nie ma w nazwie
 * wariantu produktu? Rodzina koloru tu nie wystarcza: "grafitowy" i "Szary"
 * należą do tej samej rodziny (grey), a mimo to sugerują inny odcień — a klient
 * czyta zdanie tuż obok zdjęcia. Zasada: wolno echem powtórzyć prawdziwy kolor
 * z nazwy, nie wolno wprowadzać innego. Kolor przy rzeczowniku-detalu (czarne
 * szkło, srebrne intarsje) jest dozwolony.
 */
export function reasonConflictsWithColor(why: string, productName: string): boolean {
  const parts = productName.split(' - ')
  const variant = parts.length > 1 ? parts.slice(1).join(' - ') : ''
  if (!variant) return false // brak jawnego wariantu → nie ma z czym porównać

  for (const stem of COLOR_WORD_STEMS) {
    if (stem.test(variant)) continue // ten kolor JEST prawdziwy — wolno go użyć
    const global = new RegExp(stem.source, 'gi')
    let match: RegExpExecArray | null
    while ((match = global.exec(why)) !== null) {
      const after = why.slice(match.index, match.index + match[0].length + 24)
      if (!DETAIL_NOUN_RE.test(after)) return true
    }
  }
  return false
}

export function classifyDoor(name: string, description: string = ''): DoorAttributes {
  const hasGlass = GLASS_RE.test(name) || GLASS_RE.test(description)

  const parts = name.split(' - ')
  const variant = parts.length > 1 ? parts[1].trim() : ''

  let colorFamily: ColorFamily | null = null
  if (variant) colorFamily = classifyVariant(variant)
  // Nazwa bazowa też bywa nośna ("czarne intarsje" opisuje wstawki, nie
  // skrzydło — dlatego bazy NIE klasyfikujemy po polsku, tylko z opisu EN).
  if (!colorFamily) colorFamily = classifyDescription(description)

  const styles = classifyStyles(description, colorFamily)

  return {
    colorFamily: colorFamily ?? 'unknown',
    hasGlass,
    lightness: colorFamily ? LIGHTNESS[colorFamily] : 3,
    styles,
  }
}
