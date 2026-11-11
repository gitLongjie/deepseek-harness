/**
 * Help-menu documentation URL resolution: the source oem.config.json wins over
 * the packaged manifest, and only HTTPS destinations pass validation.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesktopContactUrl, resolveDesktopHelpDocsUrl } from '../src/main/desktop/help-links.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Build a repo-shaped anchor with an optional oem.config.json beside it. */
function fixture(oem?: string | Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-help-'))
  roots.push(root)
  mkdirSync(join(root, 'apps', 'desktop'), { recursive: true })
  const anchor = join(root, 'apps', 'desktop', 'package.json')
  writeFileSync(anchor, '{}')
  if (oem !== undefined) {
    const fields = typeof oem === 'string' ? { helpDocsUrl: oem } : oem
    writeFileSync(join(root, 'oem.config.json'), JSON.stringify(fields))
  }
  return anchor
}

describe('desktop help documentation URL', () => {
  it('prefers the source-tree oem.config.json over the packaged manifest', () => {
    const anchor = fixture('https://docs.acme.test/')
    expect(resolveDesktopHelpDocsUrl(anchor, { dsh: { helpDocsUrl: 'https://manifest.acme.test/' } }))
      .toBe('https://docs.acme.test/')
  })

  it('falls back to the packaged manifest and tolerates its absence', () => {
    const anchor = fixture()
    expect(resolveDesktopHelpDocsUrl(anchor, { dsh: { helpDocsUrl: 'https://manifest.acme.test/' } }))
      .toBe('https://manifest.acme.test/')
    expect(resolveDesktopHelpDocsUrl(anchor, {})).toBeUndefined()
  })

  it('rejects empty values and non-HTTPS destinations', () => {
    expect(() => resolveDesktopHelpDocsUrl(fixture(''), {})).toThrow(/non-empty/)
    expect(() => resolveDesktopHelpDocsUrl(fixture('http://docs.acme.test/'), {})).toThrow(/HTTPS/)
    expect(() => resolveDesktopHelpDocsUrl(fixture('not a url'), {})).toThrow(/HTTPS/)
    expect(() => resolveDesktopHelpDocsUrl(fixture(), { dsh: { helpDocsUrl: 42 } })).toThrow(/non-empty/)
  })
})

describe('desktop help contact URL', () => {
  it('prefers the source-tree oem.config.json over the packaged manifest', () => {
    const anchor = fixture({ contactUrl: 'https://support.acme.test/contact' })
    expect(resolveDesktopContactUrl(anchor, { dsh: { contactUrl: 'https://manifest.acme.test/contact' } }))
      .toBe('https://support.acme.test/contact')
  })

  it('falls back to the packaged manifest and tolerates its absence', () => {
    const anchor = fixture()
    expect(resolveDesktopContactUrl(anchor, { dsh: { contactUrl: 'https://manifest.acme.test/contact' } }))
      .toBe('https://manifest.acme.test/contact')
    expect(resolveDesktopContactUrl(anchor, {})).toBeUndefined()
  })

  it('rejects empty values and non-HTTPS destinations', () => {
    expect(() => resolveDesktopContactUrl(fixture({ contactUrl: '' }), {})).toThrow(/non-empty/)
    expect(() => resolveDesktopContactUrl(fixture({ contactUrl: 'http://support.acme.test/' }), {})).toThrow(/HTTPS/)
    expect(() => resolveDesktopContactUrl(fixture({ contactUrl: 'not a url' }), {})).toThrow(/HTTPS/)
    expect(() => resolveDesktopContactUrl(fixture(), { dsh: { contactUrl: 42 } })).toThrow(/non-empty/)
  })

  it('reads the contact page without requiring a documentation URL', () => {
    const anchor = fixture({ helpDocsUrl: 'https://docs.acme.test/', contactUrl: 'https://support.acme.test/contact?from=menu' })
    expect(resolveDesktopHelpDocsUrl(anchor, {})).toBe('https://docs.acme.test/')
    expect(resolveDesktopContactUrl(anchor, {})).toBe('https://support.acme.test/contact?from=menu')
  })
})
