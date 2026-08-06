import { describe, it, expect } from 'vitest'
import { rozjazd } from '../buildStyleReview'

describe('rozjazd — miara niezgody opisu z wizją', () => {
  it('identyczne zestawy → 0', () => {
    expect(rozjazd(['nowoczesny'], ['nowoczesny'])).toBe(0)
    expect(rozjazd(['nowoczesny', 'loft'], ['loft', 'nowoczesny'])).toBe(0)
  })

  it('styl tylko w wizji liczy się jako rozjazd', () => {
    expect(rozjazd(['nowoczesny'], ['nowoczesny', 'rustykalny'])).toBe(1)
  })

  it('styl tylko w opisie też liczy się jako rozjazd', () => {
    expect(rozjazd(['nowoczesny', 'rustykalny'], ['nowoczesny'])).toBe(1)
  })

  it('rozłączne zestawy → suma obu stron', () => {
    expect(rozjazd(['klasyczny'], ['rustykalny', 'skandynawski'])).toBe(3)
  })

  it('puste zestawy → 0', () => {
    expect(rozjazd([], [])).toBe(0)
  })
})
