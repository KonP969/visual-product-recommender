import { describe, it, expect } from 'vitest'
import { stylesForModel } from '../styleResolver'

describe('stylesForModel — opisy wariantów modelu → styl modelu', () => {
  it('większość opisów decyduje', () => {
    expect(
      stylesForModel([
        'modern residential interior door light oak',
        'modern residential interior door white',
        'classic raised panel residential door',
      ]),
    ).toEqual(['nowoczesny'])
  })

  it('pojedyncza wzmianka o rustic nie robi modelu rustykalnym', () => {
    const opisy = [
      'modern residential interior door light oak',
      'modern residential interior door natural oak',
      'modern design, honey acacia veneer, adding a rustic touch',
    ]
    expect(stylesForModel(opisy)).toEqual(['nowoczesny'])
  })

  it('model realnie rustykalny zostaje rustykalny', () => {
    const opisy = [
      'rustic knotty pine residential door',
      'rustic farmhouse style residential door',
      'rustic residential interior door',
    ]
    expect(stylesForModel(opisy)).toEqual(['rustykalny'])
  })

  it('opisy bez sygnału stylu → pusto', () => {
    expect(stylesForModel(['residential interior door', 'interior door white'])).toEqual([])
  })
})
