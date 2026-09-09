import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  oemClientBuildEnvironment, oemKnowledgeBaseEnvironment, parseOemConfig, projectOemWebManifest,
} from './oem-config.ts'

const valid = {
  productName: 'Acme Agent',
  brandIcon: '/brand/acme.ico',
  loginUrl: 'https://accounts.acme.test/api/login',
  updateUrl: 'https://updates.acme.test/desktop',
  knowledgeBase: {
    baseUrl: 'http://weknora.internal:8080/api/v1',
    apiKeyEnv: 'ACME_KB_KEY',
  },
  loginTagline: {
    zh: '探索 Acme 妙想之境',
    en: 'Explore the Acme realm of wonder',
  },
  greetings: {
    zh: {
      morning: '早上好', noon: '中午好', afternoon: '下午好', evening: '晚上好', night: '夜深了',
    },
    en: {
      morning: 'Good morning', noon: 'Good noon', afternoon: 'Good afternoon',
      evening: 'Good evening', night: 'Good night',
    },
  },
}

describe('OEM configuration', () => {
  it('projects every browser-owned value into the shared client build environment', () => {
    expect(oemClientBuildEnvironment(parseOemConfig(valid, 'fixture'))).toEqual({
      DSH_CLIENT_BRAND_ICON: '/brand/acme.ico',
      DSH_CLIENT_BRAND_NAME: 'Acme Agent',
      DSH_CLIENT_GREETINGS_EN: JSON.stringify(valid.greetings.en),
      DSH_CLIENT_GREETINGS_ZH: JSON.stringify(valid.greetings.zh),
      DSH_CLIENT_LOGIN_TAGLINE_EN: valid.loginTagline.en,
      DSH_CLIENT_LOGIN_TAGLINE_ZH: valid.loginTagline.zh,
      DSH_CLIENT_LOGIN_URL: 'https://accounts.acme.test/api/login',
      DSH_CLIENT_TITLE: 'Acme Agent',
    })
  })

  it('rejects incomplete, extra, and unsafe deployment values before compilation', () => {
    expect(() => { parseOemConfig({ ...valid, extra: true }, 'fixture') }).toThrow(/extra/)
    expect(() => { parseOemConfig({ ...valid, productName: '' }, 'fixture') }).toThrow(/productName/)
    expect(() => { parseOemConfig({ ...valid, productName: '../Acme' }, 'fixture') }).toThrow(/Windows filename/)
    expect(() => { parseOemConfig({ ...valid, productName: 'CON' }, 'fixture') }).toThrow(/Windows filename/)
    expect(() => { parseOemConfig({ ...valid, productName: 'Acme.' }, 'fixture') }).toThrow(/Windows filename/)
    expect(() => { parseOemConfig({ ...valid, brandIcon: 'javascript:alert(1)' }, 'fixture') }).toThrow(/brandIcon/)
    expect(() => { parseOemConfig({ ...valid, brandIcon: '/brand/acme.svg' }, 'fixture') }).toThrow(/\.ico/)
    expect(() => { parseOemConfig({ ...valid, brandIcon: 'https://cdn.acme.test/icon.ico' }, 'fixture') })
      .toThrow(/local/)
    expect(() => { parseOemConfig({ ...valid, loginUrl: 'ftp://accounts.acme.test' }, 'fixture') }).toThrow(/loginUrl/)
    expect(() => { parseOemConfig({ ...valid, updateUrl: 'http://updates.acme.test' }, 'fixture') }).toThrow(/updateUrl/)
    expect(() => { parseOemConfig({ ...valid, loginTagline: { zh: '只有中文' } }, 'fixture') }).toThrow(/loginTagline/)
    expect(() => {
      parseOemConfig({ ...valid, greetings: { ...valid.greetings, en: { morning: 'only one' } } }, 'fixture')
    }).toThrow(/greetings\.en/)
  })

  it('accepts a plain-HTTP login endpoint while keeping the update URL HTTPS-only', () => {
    expect(parseOemConfig({ ...valid, loginUrl: 'http://accounts.acme.test/api/login' }, 'fixture').loginUrl)
      .toBe('http://accounts.acme.test/api/login')  })

  it('keeps the repository OEM file parseable as the build source of truth', () => {
    const path = resolve(import.meta.dirname, '..', 'oem.config.json')
    expect(() => { parseOemConfig(JSON.parse(readFileSync(path, 'utf8')), path) }).not.toThrow()
  })

  it('projects the configured product and icon into install metadata', () => {
    expect(projectOemWebManifest({
      id: '/',
      name: 'Old name',
      short_name: 'Old',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      icons: [{ src: '/favicon.ico', sizes: 'any', type: 'image/x-icon', purpose: 'any' }],
    }, parseOemConfig(valid, 'fixture'))).toEqual({
      id: '/',
      name: 'Acme Agent',
      short_name: 'Acme Agent',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      icons: [{ src: '/brand/acme.ico', sizes: 'any', type: 'image/x-icon', purpose: 'any' }],
    })
  })

  it('projects the knowledge-base connection into the plugin default environment', () => {
    expect(oemKnowledgeBaseEnvironment(parseOemConfig(valid, 'fixture'))).toEqual({
      WEKNORA_API_KEY_ENV: 'ACME_KB_KEY',
      WEKNORA_BASE_URL: 'http://weknora.internal:8080/api/v1',
    })
    expect(oemKnowledgeBaseEnvironment(parseOemConfig({
      ...valid,
      knowledgeBase: {
        baseUrl: 'http://weknora.internal:8080/api/v1',
        apiKeyEnv: 'ACME_KB_KEY',
        tenantId: 'ws-1',
        webUiUrl: 'http://weknora.internal:8080',
      },
    }, 'fixture'))).toEqual({
      WEKNORA_API_KEY_ENV: 'ACME_KB_KEY',
      WEKNORA_BASE_URL: 'http://weknora.internal:8080/api/v1',
      WEKNORA_TENANT_ID: 'ws-1',
      WEKNORA_WEB_UI_URL: 'http://weknora.internal:8080',
    })
  })

  it('rejects a malformed knowledge-base section before anything compiles', () => {
    expect(() => {
      parseOemConfig({ ...valid, knowledgeBase: { baseUrl: 'ftp://weknora.internal' } }, 'fixture')
    }).toThrow(/knowledgeBase\.baseUrl/)
    expect(() => {
      parseOemConfig({ ...valid, knowledgeBase: { apiKeyEnv: 'ACME_KB_KEY' } }, 'fixture')
    }).toThrow(/knowledgeBase\.baseUrl/)
    expect(() => {
      parseOemConfig({ ...valid, knowledgeBase: { ...valid.knowledgeBase, token: 'sk-secret' } }, 'fixture')
    }).toThrow(/invalid fields/)
    expect(() => {
      parseOemConfig({ ...valid, knowledgeBase: { ...valid.knowledgeBase, webUiUrl: 'javascript:alert(1)' } }, 'fixture')
    }).toThrow(/knowledgeBase\.webUiUrl/)
  })
})
