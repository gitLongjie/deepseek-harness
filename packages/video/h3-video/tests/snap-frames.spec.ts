/**
 * H3 frame-grid snapping test: durations convert to the model's `17k + 5` frame lengths at 24 fps.
 */

import { describe, expect, it } from 'vitest'
import { snapH3Frames } from '../src/comfyui.ts'

describe('snapH3Frames', () => {
  it('snaps to the 17k + 5 grid at 24 fps', () => {
    // 5s -> 120 frames, snapped up to 124 (17*7+5)
    expect(snapH3Frames(5)).toBe(124)
    // 10s -> 240 frames, snapped up to 243 (17*14+5)
    expect(snapH3Frames(10)).toBe(243)
    // 2s -> 48 frames, snapped to 56 (17*3+5)
    expect(snapH3Frames(2)).toBe(56)
    // sub-frame durations still snap up
    expect(snapH3Frames(4.2)).toBeGreaterThanOrEqual(101)
    // tiny durations clamp to the 5-frame minimum
    expect(snapH3Frames(0.1)).toBe(5)
  })
})
