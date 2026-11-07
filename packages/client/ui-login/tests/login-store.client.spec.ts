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
    expect(store.store.getSnapshot()).toEqual({ restoring: false, session: null, busy: false, error: null, balance: null })
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
    expect(store.store.getSnapshot()).toEqual({ restoring: false, session: null, busy: false, error: null, balance: null })
  })

  it('enters the app on a still-accepted key without creating a login session', async () => {
    storeRecord(storedRecord)
    const fetchMock = vi.fn((url: string) => Promise.resolve(url === MODELS_URL
      ? respond({ object: 'list', data: [] })
      : respond({ success: true, data: {} })))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await store.restore()
    // One read of the model list, and no POST to the login endpoint: the
    // server charges a login session for that call alone. (The token-quota
    // read hits /api/usage/token/, not this one.)
    const modelReads = fetchMock.mock.calls.filter(([url]) => url === MODELS_URL)
    expect(modelReads).toHaveLength(1)
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
    const fetchMock = vi.fn((url: string) => Promise.resolve(
      url === AUTH_URL ? respond(okBody) : respond({ success: true, data: {} }),
    ))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = adapter()
    const store = new LoginStore(AUTH_URL, credentials, dummyApi)
    await store.restore()
    // One POST to the login endpoint; the token-quota read hits
    // /api/usage/token/ instead of creating a second login session.
    const authPosts = fetchMock.mock.calls.filter(([url]) => url === AUTH_URL)
    expect(authPosts).toHaveLength(1)
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

describe('LoginStore balance', () => {
  const TOKEN_USAGE_URL = 'https://claw.deepagens.com/api/usage/token/'

  /** A token-usage success body: used and remaining counts, optional unlimited flag. */
  function tokenUsage(used: number, remaining: number, unlimited = false): unknown {
    return {
      code: true,
      message: 'ok',
      data: { total_used: used, total_available: remaining, unlimited_quota: unlimited },
    }
  }

  /**
   * Fetch mock over the login endpoint and the token-usage endpoint.
   * Anything else is a 404.
   */
  function stubGateway(usage: () => Response | Promise<Response> = () => respond(tokenUsage(0, 0))): void {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === AUTH_URL) return Promise.resolve(respond(okBody))
      if (url === TOKEN_USAGE_URL) return Promise.resolve(usage())
      return Promise.resolve(respond({ error: 'unexpected call' }, 404))
    }))
  }

  async function signIn(controller: LoginStore): Promise<void> {
    await expect(controller.login('jiege', 'pw')).resolves.toBe(true)
  }

  it('reads used and remaining token counts after a sign-in', async () => {
    let usageInit: RequestInit | undefined
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === AUTH_URL) return Promise.resolve(respond(okBody))
      if (url === TOKEN_USAGE_URL) {
        usageInit = init
        return Promise.resolve(respond(tokenUsage(12345, 987655)))
      }
      return Promise.resolve(respond({ error: 'unexpected call' }, 404))
    }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    await vi.waitFor(() => {
      expect(store.store.getSnapshot().balance).toMatchObject({
        status: 'ready', usedTokens: 12345, remainingTokens: 987655, unlimited: false,
      })
    })
    expect(usageInit).toEqual({ headers: { authorization: 'Bearer sk-1' } })
  })

  it('reports an unlimited key without treating a zero remainder as the cap', async () => {
    stubGateway(() => respond(tokenUsage(80, 0, true)))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    await vi.waitFor(() => {
      expect(store.store.getSnapshot().balance).toMatchObject({
        status: 'ready', usedTokens: 80, remainingTokens: 0, unlimited: true,
      })
    })
  })

  it('reports unavailable when the token-usage endpoint refuses and no value exists', async () => {
    stubGateway(() => respond({ error: 'quota service down' }, 500))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    await vi.waitFor(() => { expect(store.store.getSnapshot().balance).toEqual({ status: 'unavailable' }) })
    expect(store.store.getSnapshot().session).not.toBeNull()
  })

  it('reports unavailable when the token-usage body is not the documented object', async () => {
    const bodies = [
      { code: true, data: null },
      { code: true, data: 'no' },
      { code: true, data: { total_used: '12', total_available: 3 } },
      { code: true, data: { total_used: 3, unlimited_quota: false } },
    ]
    for (const body of bodies) {
      stubGateway(() => respond(body))
      const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
      await signIn(store)
      await vi.waitFor(() => { expect(store.store.getSnapshot().balance).toEqual({ status: 'unavailable' }) })
      store.logout()
    }
  })

  it('reports unavailable when the body omits the token counts', async () => {
    stubGateway(() => respond({ code: true, data: { total_used: -1, unlimited_quota: false } }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    await vi.waitFor(() => { expect(store.store.getSnapshot().balance).toEqual({ status: 'unavailable' }) })
  })

  it('reports unavailable when the body is not JSON', async () => {
    stubGateway(() => new Response('<html>', { status: 200 }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    await vi.waitFor(() => { expect(store.store.getSnapshot().balance).toEqual({ status: 'unavailable' }) })
  })

  it('keeps the last good value when a re-read fails', async () => {
    let failing = false
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === AUTH_URL) return Promise.resolve(respond(okBody))
      if (url === TOKEN_USAGE_URL) {
        return Promise.resolve(failing ? respond('gateway exploded', 500) : respond(tokenUsage(12345, 987655)))
      }
      return Promise.resolve(respond({ error: 'unexpected call' }, 404))
    }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    await vi.waitFor(() => {
      expect(store.store.getSnapshot().balance).toMatchObject({ status: 'ready', usedTokens: 12345, remainingTokens: 987655 })
    })
    failing = true
    await store.refreshBalance()
    expect(store.store.getSnapshot().balance).toMatchObject({ status: 'ready', usedTokens: 12345, remainingTokens: 987655 })
  })

  it('drops an in-flight result when the session ends before the reads settle', async () => {
    const pending: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === AUTH_URL) return Promise.resolve(respond(okBody))
      return new Promise<Response>((resolveResponse) => { pending.push(resolveResponse) })
    }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    expect(store.store.getSnapshot().balance).toEqual({ status: 'loading' })
    store.logout()
    expect(store.store.getSnapshot().balance).toBeNull()
    for (const resolveResponse of pending) resolveResponse(respond(tokenUsage(99, 1)))
    await Promise.resolve()
    await Promise.resolve()
    // The stale read belongs to the ended session and must not publish into it.
    expect(store.store.getSnapshot().balance).toBeNull()
    expect(store.store.getSnapshot().session).toBeNull()
  })

  it('resets the balance to null on logout', async () => {
    stubGateway(() => respond(tokenUsage(0, 10)))
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === AUTH_URL) return Promise.resolve(respond(okBody))
      if (url === TOKEN_USAGE_URL) return Promise.resolve(respond(tokenUsage(0, 10)))
      return Promise.resolve(respond({ error: 'unexpected call' }, 404))
    }))
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await signIn(store)
    await vi.waitFor(() => { expect(store.store.getSnapshot().balance?.status).toBe('ready') })
    store.logout()
    expect(store.store.getSnapshot().balance).toBeNull()
  })

  it('skips the read while signed out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = new LoginStore(AUTH_URL, adapter(), dummyApi)
    await store.refreshBalance()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.store.getSnapshot().balance).toBeNull()
  })
})
