import { describe, expect, it, vi } from 'vitest'
import { afterEach } from 'vitest'
import { assertPublicHttpsUrl, fetchJsonBounded, MarketFetchError } from '../src/http.ts'

afterEach(() => { vi.unstubAllGlobals() })

const OPTIONS = { timeoutMs: 1_000, maxBytes: 1_000 }

describe('assertPublicHttpsUrl', () => {
  it('accepts public https endpoints on the standard port', () => {
    expect(assertPublicHttpsUrl('https://registry.npmjs.org/pkg/latest').hostname).toBe('registry.npmjs.org')
    expect(assertPublicHttpsUrl('https://example.com.:443/v1/plugins').hostname).toBe('example.com.')
  })

  it('rejects non-https schemes, user info, and non-standard ports', () => {
    expect(() => assertPublicHttpsUrl('http://example.com/x')).toThrow(MarketFetchError)
    expect(() => assertPublicHttpsUrl('https://user:pass@example.com/x')).toThrow(/user info/)
    expect(() => assertPublicHttpsUrl('https://example.com:8080/x')).toThrow(/standard HTTPS port/)
    expect(() => assertPublicHttpsUrl('ftp://example.com/x')).toThrow(/https:\/\//)
  })

  it('rejects local, internal, and IP-literal hosts', () => {
    for (const host of [
      'https://localhost/x',
      'https://sub.localhost/x',
      'https://shop.local/x',
      'https://svc.internal/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://10.0.0.1/x',
    ]) {
      expect(() => assertPublicHttpsUrl(host)).toThrow(/not a public domain name/)
    }
  })

  it('rejects single-label hosts and unparseable URLs', () => {
    expect(() => assertPublicHttpsUrl('https://onlylabel/x')).toThrow(/not a public domain name/)
    expect(() => assertPublicHttpsUrl('not a url')).toThrow(/not a valid URL/)
  })
})

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 })
}

describe('fetchJsonBounded', () => {
  it('parses a JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).resolves.toEqual({ ok: true })
  })

  it('follows https redirects and re-validates every hop', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/a' } }))
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/v1/plugins' } }))
      .mockResolvedValueOnce(jsonResponse({ hop: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchJsonBounded('https://example.com/plugins', OPTIONS)).resolves.toEqual({ hop: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect((fetchMock.mock.calls[1]![0] as URL).href).toBe('https://cdn.example.com/a')
    expect((fetchMock.mock.calls[2]![0] as URL).href).toBe('https://cdn.example.com/v1/plugins')
  })

  it('rejects redirects without a location and redirect chains beyond the cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302 })))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/carries no location/)

    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/next' } }))
    vi.stubGlobal('fetch', loop)
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/more than 3 redirects/)
    expect(loop).toHaveBeenCalledTimes(4)
  })

  it('rejects a redirect that leaves the transport contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://example.com/x' } })))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/only https:\/\//)
  })

  it('rejects non-2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/HTTP 503/)
  })

  it('rejects oversized bodies and cancels the stream', async () => {
    const big = 'x'.repeat(1_001)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`"${big}"`, { status: 200 })))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/exceeds the 1000-byte limit/)
  })

  it('rejects empty and non-JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/empty response body/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/not valid JSON/)
  })

  it('wraps network failures, including a nested cause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/request to https:\/\/example\.com\/v1\/plugins failed$/)

    const cause = new Error('getaddrinfo ENOTFOUND')
    const wrapped = new TypeError('fetch failed') as TypeError & { cause?: unknown }
    wrapped.cause = cause
    vi.stubGlobal('fetch', vi.fn(async () => { throw wrapped }))
    await expect(fetchJsonBounded('https://example.com/v1/plugins', OPTIONS)).rejects.toThrow(/ENOTFOUND/)
  })

  it('rejects the input URL before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchJsonBounded('http://example.com/v1/plugins', OPTIONS)).rejects.toThrow(MarketFetchError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
