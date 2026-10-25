// @vitest-environment jsdom
/** Login store behavior: the boot-time key revalidation, the pair replay, the Deepagens Claw wire contract, and credential handoff. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LoginStore, readStoredLogin,
  type LoginApi,
  type LoginCredentialAdapter,
  type LoginSession,
} from '../src/client/login-store.ts'

const AUTH_URL = 'https://claw.deepagens.com/api/claw/login'
const MODELS_URL = 'https://claw.deepagens.com/v1/models'

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
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function adapter(overrides: Partial<LoginCredentialAdapter> = {}): LoginCredentialAdapter & {
  calls: { applied: LoginSession[]; cleared: number }
} {
  const calls = { applied: [] as LoginSession[], cleared: 0 }
  return Object.assign({
    async apply(session: LoginSession) { calls.applied.push(session) },
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

/** The record a completed sign-in stores under `dsh.login.pair`. */
const storedRecord = {
  username: 'jiege',
  password: 'pw',
  apiKey: 'sk-1',
  account: '杰哥',
  avatar: 'https://claw.deepagens.com/avatar/1.png',
}

function storeRecord(record: unknown): void {
  localStorage.setItem('dsh.login.pair', JSON.stringify(record))
}

describe('readStoredLogin', () => {
  it('reads a record written before key reuse as a pair', () => {
    storeRecord({ username: 'jiege', password: 'pw' })
    expect(readStoredLogin()).toEqual({ username: 'jiege', password: 'pw' })
  })

  it('reads the key and profile a later sign-in stored', () => {
    storeRecord(storedRecord)
    expect(readStoredLogin()).toEqual(storedRecord)
  })

  it('drops optional fields of the wrong type and keeps a usable pair', () => {
    storeRecord({ username: 'jiege', password: 'pw', apiKey: 3, account: '', avatar: 7 })
    expect(readStoredLogin()).toEqual({ username: 'jiege', password: 'pw' })
  })

  it('treats absent, corrupted, and malformed values as absent', () => {
    expect(readStoredLogin()).toBeNull()
    localStorage.setItem('dsh.login.pair', '{oops')
    expect(readStoredLogin()).toBeNull()
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'x' }))
    expect(readStoredLogin()).toBeNull()
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'x', password: 3 }))
    expect(readStoredLogin()).toBeNull()
  })
})

describe('LoginStore', () => {
  it('derives the relay origin from the login endpoint', () => {
    expect(new LoginStore(AUTH_URL, adapter(), dummyApi).baseUrl()).toBe('https://claw.deepagens.com')
  })

  it('starts signed out before any sign-in or restore', () => {
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
      { account: '杰哥', avatar: 'https://claw.deepagens.com/avatar/1.png', apiKey: 'sk-1' },
    ])
    expect(store.store.getSnapshot().session?.account).toBe('杰哥')
  })

  it('stores the pair, the issued key, and the profile, never the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(okBody)))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(true)
    expect(readStoredLogin()).toEqual(storedRecord)
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

  it('drops the session, the stored record, and the credentials on logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(okBody)))
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await expect(store.login('jiege', 'pw')).resolves.toBe(true)
    store.logout()
    expect(store.store.getSnapshot().session).toBeNull()
    expect(readStoredLogin()).toBeNull()
    expect(credentials.calls.cleared).toBe(1)
  })
})

describe('LoginStore restore', () => {
  it('is a no-op without a stored record', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await expect(store.restore()).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.store.getSnapshot()).toEqual({ restoring: false, session: null, busy: false, error: null })
  })

  it('enters the app on a still-accepted key without creating a login session', async () => {
    storeRecord(storedRecord)
    const fetchMock = vi.fn().mockResolvedValue(respond({ object: 'list', data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await store.restore()
    // One read of the model list, and no POST to the login endpoint: the
    // server charges a login session for that call alone.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(MODELS_URL, { headers: { authorization: 'Bearer sk-1' } })
    expect(credentials.calls.applied).toEqual([
      { account: '杰哥', avatar: 'https://claw.deepagens.com/avatar/1.png', apiKey: 'sk-1' },
    ])
    expect(store.store.getSnapshot()).toMatchObject({
      restoring: false,
      session: { account: '杰哥', avatar: 'https://claw.deepagens.com/avatar/1.png', apiKey: 'sk-1' },
      error: null,
    })
    // The catalog refresh still runs on the accepted key.
    expect(discoverMock).toHaveBeenCalled()
  })

  it('falls back to the username when the stored record carries no profile', async () => {
    storeRecord({ username: 'jiege', password: 'pw', apiKey: 'sk-1' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ object: 'list', data: [] })))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await store.restore()
    expect(store.store.getSnapshot().session).toEqual({ account: 'jiege', avatar: null, apiKey: 'sk-1' })
  })

  it('replays the stored pair when the gateway refuses the stored key', async () => {
    storeRecord(storedRecord)
    const fetchMock = vi.fn((url: string) => Promise.resolve(url === MODELS_URL
      ? respond({ error: 'invalid token' }, 401)
      : respond({ success: true, data: { display_name: '杰哥', avatar: null, api_key: 'sk-2' } })))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await store.restore()
    expect(fetchMock).toHaveBeenCalledWith(AUTH_URL, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'jiege', password: 'pw' }),
    }))
    expect(store.store.getSnapshot()).toMatchObject({ restoring: false, session: { apiKey: 'sk-2' } })
    // The fresh sign-in stores the key it issued in place of the refused one.
    expect(readStoredLogin()).toMatchObject({ apiKey: 'sk-2' })
  })

  it('replays the stored pair when the key check cannot reach the gateway', async () => {
    storeRecord(storedRecord)
    const fetchMock = vi.fn((url: string) => url === MODELS_URL
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve(respond(okBody)))
    vi.stubGlobal('fetch', fetchMock)
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await store.restore()
    expect(fetchMock).toHaveBeenCalledWith(AUTH_URL, expect.objectContaining({ method: 'POST' }))
    expect(store.store.getSnapshot()).toMatchObject({ session: { account: '杰哥' } })
  })

  it('replays a record written before key reuse', async () => {
    storeRecord({ username: 'jiege', password: 'pw' })
    const fetchMock = vi.fn().mockResolvedValue(respond(okBody))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await store.restore()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(AUTH_URL, expect.objectContaining({ method: 'POST' }))
    expect(credentials.calls.applied).toHaveLength(1)
    expect(store.store.getSnapshot()).toMatchObject({ restoring: false, session: { account: '杰哥' } })
  })

  it('falls back to the gate with the server message when the stored pair is refused', async () => {
    storeRecord({ username: 'jiege', password: 'stale', apiKey: 'sk-old' })
    const fetchMock = vi.fn((url: string) => Promise.resolve(
      url === MODELS_URL ? respond({ error: 'invalid token' }, 401) : respond({ success: false, message: '用户名或密码错误' }),
    ))
    vi.stubGlobal('fetch', fetchMock)
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await store.restore()
    expect(store.store.getSnapshot()).toMatchObject({ restoring: false, session: null, error: '用户名或密码错误' })
    // The refused record stays stored: the next launch retries the silent sign-in.
    expect(readStoredLogin()).toMatchObject({ username: 'jiege', password: 'stale', apiKey: 'sk-old' })
  })
})
