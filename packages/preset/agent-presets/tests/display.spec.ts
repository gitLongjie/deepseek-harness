/**
 * Display resolution: shipped presets resolve through dictionary keys, and
 * user-authored metadata is never translated. The expert marker is the other
 * half of the roster's presentation policy: one predicate decides which rows
 * are market inventory and which are session modes.
 */

import { describe, expect, it } from 'vitest'
import { isExpertPreset, presetDisplayText, type BuiltInPresetCopyKey } from '../src/display.ts'

const t = (key: BuiltInPresetCopyKey): string => `t:${key}`

describe('presetDisplayText', () => {
  it('resolves a shipped preset through its dictionary keys', () => {
    expect(presetDisplayText({ id: 'standard', trust: 'system', name: '标准模式' }, t)).toEqual({
      name: 't:presetStandardName',
      description: 't:presetStandardDescription',
    })
  })

  it('keeps user-authored metadata untranslated', () => {
    expect(presetDisplayText({ id: 'mine', trust: 'user', name: '我的模式', description: '自述' }, t))
      .toEqual({ name: '我的模式', description: '自述' })
  })

  it('falls back to the id for a preset publishing no metadata', () => {
    // A system id outside the shipped set behaves like authored metadata:
    // there is no dictionary copy to resolve.
    expect(presetDisplayText({ id: 'future', trust: 'system' }, t)).toEqual({ name: 'future' })
    expect(presetDisplayText({ id: 'bare', trust: 'user' }, t)).toEqual({ name: 'bare' })
  })
})

describe('isExpertPreset', () => {
  it('marks a row that publishes a category as expert inventory', () => {
    // The market admits exactly these rows; the mode surfaces exclude them.
    expect(isExpertPreset({ category: 'marketing' })).toBe(true)
  })

  it('keeps a row without a category a session mode', () => {
    expect(isExpertPreset({})).toBe(false)
  })

  it('marks a row that publishes card content without the committed marker', () => {
    // An expert authored elsewhere — copied in, or delivered as an installed
    // package — arrives without this deployment's committed `category`, so its
    // card content is what has to identify it. Without this the row would be
    // offered by the mode chip and never appear in the market at all.
    expect(isExpertPreset({ tags: ['报价', '结算'] })).toBe(true)
    expect(isExpertPreset({ quickPrompts: ['给这个品牌报个价'] })).toBe(true)
  })

  it('leaves a mode preset a mode however it decorates itself', () => {
    // `description` is on every mode preset, and a glyph is a decoration one
    // may reasonably add; neither may move a mode out of the picker.
    expect(isExpertPreset({ description: '完整的编码 agent。' })).toBe(false)
    expect(isExpertPreset({ icon: '🔧' })).toBe(false)
    expect(isExpertPreset({ tags: [] })).toBe(false)
  })
})
