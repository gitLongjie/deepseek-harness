import { describe, expect, it } from 'vitest'
import { darwinRendererSwitches } from '../src/main/desktop/darwin-renderer.ts'

describe('macOS renderer switches', () => {
  it('selects Ganesh on M1 and M2, including the Pro, Max, and Ultra models', () => {
    for (const model of ['Apple M1', 'Apple M1 Pro', 'Apple M1 Max', 'Apple M1 Ultra', 'Apple M2', 'Apple M2 Pro', 'Apple M2 Max', 'Apple M2 Ultra', '  Apple M2 Pro  ']) {
      expect(darwinRendererSwitches('darwin', model)).toEqual(['disable-skia-graphite'])
    }
  })

  it('keeps Graphite on later Apple silicon, unknown models, and other platforms', () => {
    for (const model of ['Apple M3', 'Apple M3 Pro', 'Apple M4', 'Apple M4 Pro', 'Apple M4 Max', 'Apple M5', 'Apple M5 Pro', 'Apple M12', '']) {
      expect(darwinRendererSwitches('darwin', model)).toEqual([])
    }
    expect(darwinRendererSwitches('win32', 'Apple M2')).toEqual([])
    expect(darwinRendererSwitches('linux', 'Apple M2 Pro')).toEqual([])
  })
})
