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
