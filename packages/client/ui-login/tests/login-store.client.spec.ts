// @vitest-environment jsdom
/** Login store behavior: hydration, the Deepagens Claw wire contract, and credential handoff. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  LoginStore, readStoredSession,
  type LoginCredentialAdapter,
  type LoginSession,
} from '../src/client/login-store.ts'

const AUTH_URL = 'https://claw.deepagens.com/api/user/deepagens-claw/login'

// Minimal API mock satisfying the LoginStore constructor: discovery returns an
// empty catalog and the settings read reports no namespaces, so a login writes
// an empty models list without tripping the "unchanged" skip.
const okEnvelope = <T>(value: T): { rpcId: unknown; result: { ok: true; value: T } } => ({
  rpcId: 'x',
  result: { ok: true, value },
})

const discoverMock = vi.fn().mockResolvedValue(okEnvelope({ models: [] }))
const describeMock = vi.fn().mockResolvedValue(okEnvelope({ writable: true, hasDocument: false, namespaces: [] }))
const mutateMock = vi.fn().mockResolvedValue(okEnvelope({ writable: true, hasDocument: false, namespaces: [] }))
const dummyApi = {
  llm: { discoverModels: discoverMock },
  settings: { describe: describeMock, mutate: mutateMock },
} as unknown as Pick<ConnectionHandle['api'], 'llm' | 'settings'>

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

describe('readStoredSession', () => {
  it('reads a well-formed stored session', () => {
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: '杰哥', avatar: 'a.png', apiKey: 'sk-1' }))
    expect(readStoredSession()).toEqual({ account: '杰哥', avatar: 'a.png', apiKey: 'sk-1' })
  })

  it('treats absent, corrupted, and malformed values as signed out', () => {
    expect(readStoredSession()).toBeNull()
    localStorage.setItem('dsh.login.session', '{oops')
    expect(readStoredSession()).toBeNull()
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: 'x' }))
    expect(readStoredSession()).toBeNull()
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: 'x', apiKey: 3, avatar: null }))
    expect(readStoredSession()).toBeNull()
  })

  it('normalizes a missing avatar to null', () => {
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: 'x', apiKey: 'k', avatar: '' }))
    expect(readStoredSession()).toEqual({ account: 'x', avatar: null, apiKey: 'k' })
  })
})

describe('LoginStore', () => {
  it('derives the relay origin from the login endpoint', () => {
    expect(new LoginStore(AUTH_URL, adapter(), dummyApi).baseUrl()).toBe('https://claw.deepagens.com')
  })

  it('hydrates the persisted session on load', () => {
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: '杰哥', avatar: null, apiKey: 'sk-1' }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', session: { account: '杰哥' } })
  })

  it('refreshes the gateway catalog when a persisted session loads', async () => {
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: '杰哥', avatar: null, apiKey: 'sk-1' }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    store.load()
    // A restored session seeds the catalog in the background; the write settles
    // after the synchronous store update returns.
    expect(discoverMock).toHaveBeenCalledWith({
      settingsNs: 'llm-deepagens',
      baseURL: 'https://claw.deepagens.com/v1',
      apiKey: 'sk-1',
    })
    await vi.waitFor(() => { expect(mutateMock).toHaveBeenCalled() })
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
    expect(readStoredSession()?.apiKey).toBe('sk-1')
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
    expect(readStoredSession()).toBeNull()
  })

  it('drops the session, the stored copy, and the credentials on logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(okBody)))
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(true)
    store.logout()
    expect(store.store.getSnapshot().session).toBeNull()
    expect(readStoredSession()).toBeNull()
    expect(credentials.calls.cleared).toBe(1)
  })
})
