// @vitest-environment jsdom
/** Login store behavior: the boot-time pair replay, the Deepagens Claw wire contract, and credential handoff. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LoginStore, readStoredPair,
  type LoginApi,
  type LoginCredentialAdapter,
  type LoginSession,
} from '../src/client/login-store.ts'

const AUTH_URL = 'https://claw.deepagens.com/api/claw/login'

// Minimal API mock satisfying the LoginStore constructor: discovery returns an
// empty catalog and the settings read reports no namespaces, so a login writes
// an empty models list without tripping the "unchanged" skip.
const okResult = <T>(value: T): { ok: true; value: T } => ({ ok: true, value })

const discoverMock = vi.fn().mockResolvedValue(okResult([]))
const describeMock = vi.fn().mockResolvedValue(okResult({ writable: true, hasDocument: false, namespaces: [] }))
const mutateMock = vi.fn().mockResolvedValue(okResult({ revision: 1 }))
const replaceMock = vi.fn().mockResolvedValue(okResult({ revision: 1 }))
const dummyApi: LoginApi = {
  llm: { discoverModels: discoverMock },
  settings: { describe: describeMock, mutate: mutateMock, replace: replaceMock },
}

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function adapter(overrides: Partial<LoginCredentialAdapter> = {}): LoginCredentialAdapter & {
  calls: { applied: Array<{ session: LoginSession; baseUrl: string }>; cleared: number }
} {
  const calls = { applied: [] as Array<{ session: LoginSession; baseUrl: string }>, cleared: 0 }
  return Object.assign({
    async apply(session: LoginSession, baseUrl: string) { calls.applied.push({ session, baseUrl }) },
    async clear() { calls.cleared += 1 },
  }, overrides, { calls })
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const okBody = {
  success: true,
  message: '',
  data: { id: 1, username: 'jiege', display_name: '杰哥', avatar: 'https://claw.deepagens.com/avatar/1.png', api_key: 'sk-1' },
}

describe('readStoredPair', () => {
  it('reads a well-formed stored pair', () => {
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'jiege', password: 'pw' }))
    expect(readStoredPair()).toEqual({ username: 'jiege', password: 'pw' })
  })

  it('treats absent, corrupted, and malformed values as absent', () => {
    expect(readStoredPair()).toBeNull()
    localStorage.setItem('dsh.login.pair', '{oops')
    expect(readStoredPair()).toBeNull()
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'x' }))
    expect(readStoredPair()).toBeNull()
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'x', password: 3 }))
    expect(readStoredPair()).toBeNull()
  })
})

describe('LoginStore', () => {
  it('derives the relay origin from the login endpoint', () => {
    expect(new LoginStore(AUTH_URL, adapter(), dummyApi).baseUrl()).toBe('https://claw.deepagens.com')
  })

  it('starts signed out before any sign-in or pair replay', () => {
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    expect(store.store.getSnapshot()).toEqual({ restoring: false, session: null, busy: false, error: null })
  })

  it('signs in on a successful Claw response and hands the key to the credential layer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(okBody))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(AUTH_URL, expect.objectContaining({ method: 'POST' }))
    expect(credentials.calls.applied).toEqual([
      { session: { account: '杰哥', avatar: 'https://claw.deepagens.com/avatar/1.png', apiKey: 'sk-1' }, baseUrl: 'https://claw.deepagens.com' },
    ])
    expect(store.store.getSnapshot().session?.account).toBe('杰哥')
  })

  it('stores the replayed pair, never the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(okBody)))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(true)
    expect(readStoredPair()).toEqual({ username: 'jiege', password: 'pw' })
    expect(localStorage.getItem('dsh.login.session')).toBeNull()
  })

  it('falls back to the username and a null avatar when the server omits them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ success: true, data: { api_key: 'sk-2' } })))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(true)
    expect(store.store.getSnapshot().session).toEqual({ account: 'jiege', avatar: null, apiKey: 'sk-2' })
  })

  it('shows the server message verbatim on a refused sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ success: false, message: '用户名或密码错误' })))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('jiege', 'wrong')).resolves.toBe(false)
    expect(store.store.getSnapshot().error).toBe('用户名或密码错误')
    expect(store.store.getSnapshot().busy).toBe(false)
  })

  it('maps a messageless refusal to the generic invalid-response key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ success: false }, 401)))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('a', 'b')).resolves.toBe(false)
    expect(store.store.getSnapshot().error).toBe('invalidResponse')
  })

  it('maps a server fault to the network key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ success: false }, 502)))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('a', 'b')).resolves.toBe(false)
    expect(store.store.getSnapshot().error).toBe('networkUnreachable')
  })

  it('rejects a success response without a usable api_key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ success: true, data: {} })))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('a', 'b')).resolves.toBe(false)
    expect(store.store.getSnapshot().error).toBe('invalidResponse')
  })

  it('treats a non-JSON body as an unrecognized response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('a', 'b')).resolves.toBe(false)
    expect(store.store.getSnapshot().error).toBe('invalidResponse')
  })

  it('reports a network/DNS/CORS refusal without breaking the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('a', 'b')).resolves.toBe(false)
    expect(store.store.getSnapshot().error).toBe('networkUnreachable')
  })

  it('aborts the sign-in when the credential write is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(okBody)))
    const store = new LoginStore(AUTH_URL, adapter({ apply: () => Promise.reject(new Error('shadowed')) }), dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(false)
    expect(store.store.getSnapshot().error).toBe('credentialWriteFailed')
  })

  it('drops the session, the stored pair, and the credentials on logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(okBody)))
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(true)
    store.logout()
    expect(store.store.getSnapshot().session).toBeNull()
    expect(readStoredPair()).toBeNull()
    expect(credentials.calls.cleared).toBe(1)
  })
})

describe('LoginStore restore', () => {
  it('is a no-op without a stored pair', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.restore()).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.store.getSnapshot()).toEqual({ restoring: false, session: null, busy: false, error: null })
  })

  it('replays the stored pair through the sign-in path', async () => {
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'jiege', password: 'pw' }))
    const fetchMock = vi.fn().mockResolvedValue(respond(okBody))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await store.restore()
    expect(fetchMock).toHaveBeenCalledWith(AUTH_URL, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'jiege', password: 'pw' }),
    }))
    expect(credentials.calls.applied).toHaveLength(1)
    expect(store.store.getSnapshot()).toMatchObject({ restoring: false, session: { account: '杰哥' } })
    expect(discoverMock).toHaveBeenCalled()
  })

  it('falls back to the gate with the server message when the stored pair is refused', async () => {
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'jiege', password: 'stale' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ success: false, message: '用户名或密码错误' })))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await store.restore()
    expect(store.store.getSnapshot()).toMatchObject({ restoring: false, session: null, error: '用户名或密码错误' })
    // The refused pair stays stored: the next launch retries the silent re-login.
    expect(readStoredPair()).toEqual({ username: 'jiege', password: 'stale' })
  })
})
