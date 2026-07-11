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

const GLASS_RE = /szyb|bulaj|przeszkl|witryn|glass|szpros|frosted|glazed/i

// Kolejność ma znaczenie: pierwsza pasująca reguła wygrywa.
// Wariant polski (część nazwy po " - ") np. "Dąb Matowy Ciemny", "Czarny Struktura".
const VARIANT_RULES: Array<[RegExp, ColorFamily]> = [
  [/czarn/i, 'black'],
  [/wenge\s*white/i, 'light_wood'],
  [/wenge|heban/i, 'dark_wood'],
  [/biał|bialy/i, 'white'],
  [/antracyt|grafit|popiel|szar|fiord|przykurzon/i, 'grey'],
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

export function classifyDoor(name: string, description: string = ''): DoorAttributes {
  const hasGlass = GLASS_RE.test(name) || GLASS_RE.test(description)

  const parts = name.split(' - ')
  const variant = parts.length > 1 ? parts[1].trim() : ''

  let colorFamily: ColorFamily | null = null
  if (variant) colorFamily = classifyVariant(variant)
  // Nazwa bazowa też bywa nośna ("czarne intarsje" opisuje wstawki, nie
  // skrzydło — dlatego bazy NIE klasyfikujemy po polsku, tylko z opisu EN).
  if (!colorFamily) colorFamily = classifyDescription(description)

  return {
    colorFamily: colorFamily ?? 'unknown',
    hasGlass,
    lightness: colorFamily ? LIGHTNESS[colorFamily] : 3,
  }
}
