import { describe, it, expect } from 'vitest'
import { wariantyOpisowo } from '../plural'

describe('wariantyOpisowo — kubełki zamiast dokładnej liczby', () => {
  it.each([
    [2, 'kilka wariantów'],
    [3, 'kilka wariantów'],
    [4, 'kilka wariantów'],
    [5, 'wiele wariantów'],
    [11, 'wiele wariantów'],
    [25, 'wiele wariantów'],
  ])('%i → %s', (n, expected) => {
    expect(wariantyOpisowo(n)).toBe(expected)
  })
})
