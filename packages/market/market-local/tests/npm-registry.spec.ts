import { afterEach, describe, expect, it, vi } from 'vitest'
import { isExactStableVersion, resolveRegistryLatest } from '../src/npm-registry.ts'

afterEach(() => { vi.unstubAllGlobals() })

const OPTIONS = { timeoutMs: 1_000, maxBytes: 64_000 }

describe('isExactStableVersion', () => {
  it('accepts only three-numeric-component release versions', () => {
    expect(isExactStableVersion('1.2.3')).toBe(true)
    expect(isExactStableVersion('0.0.0')).toBe(true)
    expect(isExactStableVersion('1.2.3-beta.1')).toBe(false)
    expect(isExactStableVersion('1.2.3+build.7')).toBe(false)
    expect(isExactStableVersion('1.2')).toBe(false)
    expect(isExactStableVersion('v1.2.3')).toBe(false)
    expect(isExactStableVersion('')).toBe(false)
  })
})

describe('resolveRegistryLatest', () => {
  it('reads the latest manifest of an unscoped package', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      name: 'dsh-plugin-todo-kit',
      version: '1.4.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const latest = await resolveRegistryLatest('https://registry.npmjs.org', 'dsh-plugin-todo-kit', OPTIONS)
    expect(latest).toEqual({
      name: 'dsh-plugin-todo-kit',
      version: '1.4.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    expect(new URL(String(fetchMock.mock.calls[0]![0])).href).toBe('https://registry.npmjs.org/dsh-plugin-todo-kit/latest')
  })

  it('encodes scoped names and trims registry trailing slashes', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await resolveRegistryLatest('https://registry.npmjs.org/', '@scope/dsh-plugin', OPTIONS)
    expect(new URL(String(fetchMock.mock.calls[0]![0])).href).toBe('https://registry.npmjs.org/@scope%2fdsh-plugin/latest')
  })

  it('answers undefined when the fetch fails or the payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(resolveRegistryLatest('https://registry.npmjs.org', 'pkg', OPTIONS)).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(resolveRegistryLatest('https://registry.npmjs.org', 'pkg', OPTIONS)).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 3 }), { status: 200 })))
    await expect(resolveRegistryLatest('https://registry.npmjs.org', 'pkg', OPTIONS)).resolves.toBeUndefined()
  })
})
