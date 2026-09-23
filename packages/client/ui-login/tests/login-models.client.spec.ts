// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import {
  LoginStore,
  type LoginApi,
  type LoginCredentialAdapter,
  type LoginSession,
} from '../src/client/login-store.ts'

const AUTH_URL = 'https://claw.deepagens.com/api/user/deepagens-claw/login'

function adapter(overrides: Partial<LoginCredentialAdapter> = {}): LoginCredentialAdapter & {
  calls: { applied: Array<{ session: LoginSession; baseUrl: string }>; cleared: number }
} {
  const calls = { applied: [] as Array<{ session: LoginSession; baseUrl: string }>, cleared: 0 }
  return Object.assign(
    {
      async apply(session: LoginSession, baseUrl: string) { calls.applied.push({ session, baseUrl }) },
      async clear() { calls.cleared += 1 },
    },
    overrides,
    { calls },
  )
}

interface ApiMockOptions {
  models?: LlmDiscoveredModel[]
  /** The `models` value the settings read reports; `undefined` omits the namespace. */
  storedModels?: unknown
  /**
   * The `agent-default-model` descriptor's resolved value the settings read
   * reports; `undefined` omits the namespace.
   */
  storedDefault?: unknown
  /** A refusal for the `agent-default-model` replace. */
  replaceRefused?: boolean
  discoverRefused?: boolean
  discoverReject?: unknown
  describeRefused?: boolean
  describeReject?: unknown
}

/** A typed api mock whose discovery/settings behavior each case scripts. */
function mockApi(options: ApiMockOptions = {}): {
  api: LoginApi
  discover: ReturnType<typeof vi.fn>
  describe: ReturnType<typeof vi.fn>
  mutate: ReturnType<typeof vi.fn>
  replace: ReturnType<typeof vi.fn>
} {
  const discover = options.discoverReject !== undefined
    ? vi.fn().mockRejectedValue(options.discoverReject)
    : options.discoverRefused === true
      ? vi.fn().mockResolvedValue({
        ok: false as const, error: { code: 'model-discovery-failed', message: 'nope', details: { settingsNs: 'llm-deepseek' } },
      })
      : vi.fn().mockResolvedValue({ ok: true as const, value: options.models ?? [] })
  const describe = options.describeReject !== undefined
    ? vi.fn().mockRejectedValue(options.describeReject)
    : options.describeRefused === true
      ? vi.fn().mockResolvedValue({
        ok: false as const, error: { code: 'internal', message: 'x', details: {} },
      })
      : vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          writable: true,
          hasDocument: false,
          namespaces: [
            ...(options.storedModels !== undefined
              ? [{ ns: 'llm-deepagens', value: { models: options.storedModels }, revision: 0 }]
              : []),
            ...(options.storedDefault !== undefined
              ? [{ ns: 'agent-default-model', value: options.storedDefault, revision: 2 }]
              : []),
          ],
        },
      })
  const mutate = vi.fn().mockResolvedValue({ ok: true as const, value: { revision: 1 } })
  const replace = options.replaceRefused === true
    ? vi.fn().mockResolvedValue({
      ok: false as const, error: { code: 'settings/rejected', message: 'nope', details: { ns: 'agent-default-model' } },
    })
    : vi.fn().mockResolvedValue({ ok: true as const, value: { revision: 3 } })
  return {
    api: {
      llm: { discoverModels: discover },
      settings: { describe, mutate, replace },
    },
    discover,
    describe,
    mutate,
    replace,
  }
}

function okLogin(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({
      success: true,
      data: { display_name: 'User', avatar: null, api_key: 'sk-test' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ))
}

const discovered: LlmDiscoveredModel[] = [
  { id: 'gpt-4o', name: 'gpt-4o', contextWindow: 128000, maxTokens: 4096 },
  { id: 'gpt-3.5', name: 'gpt-3.5' },
]

const expectedModels = [
  {
    id: 'gpt-4o',
    name: 'gpt-4o',
    description: '',
    contextWindow: 128000,
    maxTokens: 4096,
    inputModalities: ['text'],
  },
  {
    id: 'gpt-3.5',
    name: 'gpt-3.5',
    description: '',
    contextWindow: 128000,
    maxTokens: 4096,
    inputModalities: ['text'],
  },
]

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('LoginStore model handling', () => {
  it('fetches models after login and writes them to settings', async () => {
    const mock = mockApi({ models: discovered })
    const credentials = adapter()
    okLogin()

    const store = new LoginStore(AUTH_URL, credentials, mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.discover).toHaveBeenCalledWith('llm-deepagens', {
      baseURL: 'https://claw.deepagens.com/v1',
      apiKey: 'sk-test',
    })
    expect(mock.mutate).toHaveBeenCalledWith(
      'llm-deepagens',
      [
        { op: 'set', path: ['baseURL'], value: 'https://claw.deepagens.com/v1' },
        { op: 'set', path: ['models'], value: expectedModels },
      ],
      undefined,
    )
  })

  it('writes when the settings read reports no namespace yet', async () => {
    const mock = mockApi({ models: discovered })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).toHaveBeenCalled()
  })

  it('writes when the stored catalog differs', async () => {
    const mock = mockApi({ models: discovered, storedModels: [{ id: 'old-model' }] })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).toHaveBeenCalledWith(
      'llm-deepagens',
      [
        { op: 'set', path: ['baseURL'], value: 'https://claw.deepagens.com/v1' },
        { op: 'set', path: ['models'], value: expectedModels },
      ],
      0,
    )
  })

  it('skips the write when the catalog is unchanged', async () => {
    const mock = mockApi({ models: discovered, storedModels: expectedModels })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).not.toHaveBeenCalled()
  })

  it('skips the write when discovery is refused', async () => {
    const mock = mockApi({ models: discovered, discoverRefused: true })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).not.toHaveBeenCalled()
    expect(mock.replace).not.toHaveBeenCalled()
  })

  it('keeps the sign-in when discovery rejects', async () => {
    const mock = mockApi({ models: discovered, discoverReject: new Error('boom') })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)
    expect(store.store.getSnapshot().session?.account).toBe('User')
    expect(mock.mutate).not.toHaveBeenCalled()
  })

  it('skips the write when the settings read is refused', async () => {
    const mock = mockApi({ models: discovered, describeRefused: true })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).not.toHaveBeenCalled()
  })

  it('keeps the sign-in when the settings read rejects', async () => {
    const mock = mockApi({ models: discovered, describeReject: new Error('boom') })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)
    expect(store.store.getSnapshot().session?.account).toBe('User')
    expect(mock.mutate).not.toHaveBeenCalled()
  })

  it('adopts the first pulled model as the default the catalog does not serve', async () => {
    const mock = mockApi({
      models: discovered,
      storedModels: expectedModels,
      storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' },
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).not.toHaveBeenCalled()
    expect(mock.replace).toHaveBeenCalledWith(
      'agent-default-model',
      { provider: 'deepagens', model: 'gpt-4o' },
      2,
    )
  })

  it('re-points the default even when the catalog is unchanged', async () => {
    const mock = mockApi({
      models: discovered,
      storedModels: expectedModels,
      storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' },
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.replace).toHaveBeenCalled()
  })

  it('keeps a default the pulled catalog already serves', async () => {
    const mock = mockApi({
      models: discovered,
      storedDefault: { provider: 'deepagens', model: 'gpt-3.5', reasoningEffort: 'high' },
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.replace).not.toHaveBeenCalled()
  })

  it('re-points a same-id default served under another provider route', async () => {
    const mock = mockApi({
      models: discovered,
      storedDefault: { provider: 'deepseek-official', model: 'gpt-4o' },
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.replace).toHaveBeenCalledWith(
      'agent-default-model',
      { provider: 'deepagens', model: 'gpt-4o' },
      2,
    )
  })

  it('keeps the sign-in when the default write is refused', async () => {
    const mock = mockApi({
      models: discovered,
      storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' },
      replaceRefused: true,
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)
    expect(store.store.getSnapshot().session?.account).toBe('User')
  })

  it('skips the default adoption when discovery lists no models', async () => {
    const mock = mockApi({ models: [], storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' } })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.replace).not.toHaveBeenCalled()
  })
})
