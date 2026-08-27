import { describe, expect, it } from 'vitest'
import { copy, en, zh, type DesktopTextKey, normalizeLocale } from '../src/main/desktop/locales.ts'

describe('desktop shell locales', () => {
  it('carries identical key sets in both directions', () => {
    const zhKeys = Object.keys(zh).sort()
    expect(Object.keys(en).sort()).toEqual(zhKeys)
  })

  it('renders non-empty copy for every key in both locales', () => {
    for (const key of Object.keys(zh) as DesktopTextKey[]) {
      expect(zh[key]).not.toBe('')
      expect(en[key]).not.toBe('')
    }
  })

  it('normalizeLocale defaults to Chinese and accepts only the shipped en id', () => {
    expect(normalizeLocale(undefined)).toBe('zh')
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('fr')).toBe('zh')
  })

  it('copy selects the locale dictionary', () => {
    expect(copy('zh')['menu.edit']).toBe('编辑')
    expect(copy('en')['menu.edit']).toBe('Edit')
  })
})
