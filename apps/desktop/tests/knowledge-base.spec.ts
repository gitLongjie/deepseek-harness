import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyKnowledgeBaseEnvironment, desktopKnowledgeBaseEnvironment,
  parseDesktopKnowledgeBase, resolveDesktopKnowledgeBase,
} from '../src/main/desktop/knowledge-base.ts'

const SECTION = {
  baseUrl: 'http://weknora.internal:8080/api/v1',
  apiKeyEnv: 'ACME_KB_KEY',
  tenantId: 'ws-1',
  webUiUrl: 'http://weknora.internal:8080',
}

describe('desktop knowledge-base resolution', () => {
  it('validates the section wherever it came from', () => {
    expect(parseDesktopKnowledgeBase(SECTION, 'test')).toEqual(SECTION)
    expect(parseDesktopKnowledgeBase({ baseUrl: 'http://weknora.internal:8080/api/v1' }, 'test'))
      .toEqual({ baseUrl: 'http://weknora.internal:8080/api/v1', apiKeyEnv: 'WEKNORA_API_KEY' })
    expect(() => { parseDesktopKnowledgeBase({ apiKeyEnv: 'K' }, 'test') }).toThrow(/baseUrl/)
    expect(() => { parseDesktopKnowledgeBase({ baseUrl: 'ftp://x' }, 'test') }).toThrow(/HTTP or HTTPS/)
    expect(() => { parseDesktopKnowledgeBase({ baseUrl: 'http://x', token: 'sk' }, 'test') }).toThrow(/invalid fields/)
    expect(() => { parseDesktopKnowledgeBase({ baseUrl: 'http://x', webUiUrl: 'javascript:alert(1)' }, 'test') })
      .toThrow(/webUiUrl/)
  })

  it('prefers the source-tree oem.config.json over the packaged manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-kb-oem-'))
    const anchor = join(dir, 'apps', 'desktop', 'package.json')
    mkdirSync(join(dir, 'apps', 'desktop'), { recursive: true })
    writeFileSync(anchor, '{}')
    writeFileSync(join(dir, 'oem.config.json'), JSON.stringify({
      productName: 'Acme Agent',
      knowledgeBase: SECTION,
    }))
    expect(resolveDesktopKnowledgeBase(anchor, { dsh: { knowledgeBase: { baseUrl: 'http://from-manifest' } } }))
      .toEqual(SECTION)

    // No source file: the packaged manifest answers.
    const empty = mkdtempSync(join(tmpdir(), 'dsh-kb-empty-'))
    const emptyAnchor = join(empty, 'apps', 'desktop', 'package.json')
    mkdirSync(join(empty, 'apps', 'desktop'), { recursive: true })
    writeFileSync(emptyAnchor, '{}')
    expect(resolveDesktopKnowledgeBase(emptyAnchor, { dsh: { knowledgeBase: SECTION } })).toEqual(SECTION)
    expect(resolveDesktopKnowledgeBase(emptyAnchor, {})).toBeUndefined()
  })

  it('projects the connection and applies it without replacing owned values', () => {
    expect(desktopKnowledgeBaseEnvironment(parseDesktopKnowledgeBase(SECTION, 'test'))).toEqual({
      WEKNORA_API_KEY_ENV: 'ACME_KB_KEY',
      WEKNORA_BASE_URL: 'http://weknora.internal:8080/api/v1',
      WEKNORA_TENANT_ID: 'ws-1',
      WEKNORA_WEB_UI_URL: 'http://weknora.internal:8080',
    })
    const target: Record<string, string | undefined> = {
      WEKNORA_BASE_URL: 'http://exported.internal/api/v1',
      WEKNORA_TIMEOUT_MS: undefined,
    }
    applyKnowledgeBaseEnvironment(target, {
      WEKNORA_API_KEY_ENV: 'ACME_KB_KEY',
      WEKNORA_BASE_URL: 'http://weknora.internal:8080/api/v1',
    })
    expect(target.WEKNORA_BASE_URL).toBe('http://exported.internal/api/v1')
    expect(target.WEKNORA_API_KEY_ENV).toBe('ACME_KB_KEY')
  })
})
