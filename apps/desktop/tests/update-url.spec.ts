/** Regression checks for desktop update URL validation. */
import { describe, expect, it } from 'vitest'
import { resolveDesktopUpdateUrl } from '../src/main/desktop/update-url.ts'

describe('desktop update URL', () => {
  it('accepts HTTPS without local rehearsal metadata', () => {
    expect(resolveDesktopUpdateUrl(undefined, {
      dsh: { updateUrl: 'https://updates.example.test/desktop' },
    })).toBe('https://updates.example.test/desktop')
  })

  it.each([
    'http://127.0.0.1:43119',
    'http://localhost:43119',
    'http://[::1]:43119',
  ])('accepts loopback HTTP with the packaged local rehearsal marker: %s', (updateUrl) => {
    expect(resolveDesktopUpdateUrl(undefined, {
      dsh: { updateUrl, localUpdateTest: true },
    })).toBe(updateUrl)
  })

  it('rejects loopback HTTP without the exact packaged marker', () => {
    expect(() => resolveDesktopUpdateUrl(undefined, {
      dsh: { updateUrl: 'http://127.0.0.1:43119' },
    })).toThrow('desktop: OEM update URL must be HTTPS')
    expect(() => resolveDesktopUpdateUrl(undefined, {
      dsh: { updateUrl: 'http://127.0.0.1:43119', localUpdateTest: 'true' },
    })).toThrow('desktop: OEM update URL must be HTTPS')
  })

  it('rejects remote HTTP even with the packaged local rehearsal marker', () => {
    expect(() => resolveDesktopUpdateUrl(undefined, {
      dsh: { updateUrl: 'http://updates.example.test/desktop', localUpdateTest: true },
    })).toThrow('desktop: OEM update URL must be HTTPS')
  })

  it('rejects malformed and missing update URLs', () => {
    expect(() => resolveDesktopUpdateUrl(undefined, {
      dsh: { updateUrl: 'not a URL', localUpdateTest: true },
    })).toThrow('desktop: OEM update URL must be HTTPS')
    expect(() => resolveDesktopUpdateUrl(undefined, {}))
      .toThrow('desktop: OEM update URL is missing')
  })

  it('prefers an explicit HTTPS update URL over packaged metadata', () => {
    expect(resolveDesktopUpdateUrl('https://override.example.test/desktop', {
      dsh: { updateUrl: 'https://updates.example.test/desktop' },
    })).toBe('https://override.example.test/desktop')
  })
})
