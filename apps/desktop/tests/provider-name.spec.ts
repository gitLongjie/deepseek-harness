import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyGatewayProviderNameEnvironment, DEEPAGENS_DISPLAY_NAME_ENV, resolveDesktopGatewayProviderName,
} from '../src/main/desktop/provider-name.ts'

describe('desktop Deepagens display-name resolution', () => {
  it('prefers the source-tree oem.config.json over the packaged manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-name-oem-'))
    const anchor = join(dir, 'apps', 'desktop', 'package.json')
    mkdirSync(join(dir, 'apps', 'desktop'), { recursive: true })
    writeFileSync(anchor, '{}')
    writeFileSync(join(dir, 'oem.config.json'), JSON.stringify({
      productName: 'Acme Agent',
      gatewayProviderName: 'From Source',
    }))
    expect(resolveDesktopGatewayProviderName(anchor, { dsh: { gatewayProviderName: 'From Manifest' } }))
      .toBe('From Source')

    // No source file: the packaged manifest answers; no field anywhere means
    // the route keeps its own name.
    const empty = mkdtempSync(join(tmpdir(), 'dsh-name-empty-'))
    const emptyAnchor = join(empty, 'apps', 'desktop', 'package.json')
    mkdirSync(join(empty, 'apps', 'desktop'), { recursive: true })
    writeFileSync(emptyAnchor, '{}')
    expect(resolveDesktopGatewayProviderName(emptyAnchor, { dsh: { gatewayProviderName: 'From Manifest' } }))
      .toBe('From Manifest')
    expect(resolveDesktopGatewayProviderName(emptyAnchor, {})).toBeUndefined()
  })

  it('rejects a present but empty name wherever it came from', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-name-bad-'))
    const anchor = join(dir, 'apps', 'desktop', 'package.json')
    mkdirSync(join(dir, 'apps', 'desktop'), { recursive: true })
    writeFileSync(anchor, '{}')
    writeFileSync(join(dir, 'oem.config.json'), JSON.stringify({ gatewayProviderName: '  ' }))
    expect(() => { resolveDesktopGatewayProviderName(anchor, {}) }).toThrow(/gatewayProviderName/)
    expect(() => { resolveDesktopGatewayProviderName(anchor, { dsh: { gatewayProviderName: 3 } }) })
      .toThrow(/gatewayProviderName/)
  })

  it('applies the name without replacing an owned environment value', () => {
    expect(DEEPAGENS_DISPLAY_NAME_ENV).toBe('DEEPAGENS_DISPLAY_NAME')
    const target: Record<string, string | undefined> = { DEEPAGENS_DISPLAY_NAME: undefined }
    applyGatewayProviderNameEnvironment(target, 'brige')
    expect(target.DEEPAGENS_DISPLAY_NAME).toBe('brige')
    applyGatewayProviderNameEnvironment(target, 'Later OEM')
    expect(target.DEEPAGENS_DISPLAY_NAME).toBe('brige')
  })
})
