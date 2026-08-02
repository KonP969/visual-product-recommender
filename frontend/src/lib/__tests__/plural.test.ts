import { describe, it, expect } from 'vitest'
import { warianty } from '../plural'

describe('warianty — polska odmiana', () => {
  it.each([
    [2, '2 warianty'],
    [3, '3 warianty'],
    [4, '4 warianty'],
    [5, '5 wariantów'],
    [11, '11 wariantów'],
    [12, '12 wariantów'], // wyjątek nastu — nie "warianty"
    [14, '14 wariantów'],
    [22, '22 warianty'], // dwadzieścia dwa warianty
    [25, '25 wariantów'],
  ])('%i → %s', (n, expected) => {
    expect(warianty(n)).toBe(expected)
  })
})
