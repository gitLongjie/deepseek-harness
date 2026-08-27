// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { DiscoveredModelView } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  LoginStore,
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

const okEnvelope = <T>(value: T): { rpcId: unknown; result: { ok: true; value: T } } => ({
  rpcId: 'x',
  result: { ok: true, value },
})

interface ApiMockOptions {
  models?: DiscoveredModelView[]
  /** The `models` value the settings read reports; `undefined` omits the namespace. */
  storedModels?: unknown
  discoverRefused?: boolean
  discoverReject?: unknown
  describeRefused?: boolean
  describeReject?: unknown
}

/** A typed api mock whose discovery/settings behavior each case scripts. */
function mockApi(options: ApiMockOptions = {}): {
  api: Pick<ConnectionHandle['api'], 'llm' | 'settings'>
  discover: ReturnType<typeof vi.fn>
  describe: ReturnType<typeof vi.fn>
  mutate: ReturnType<typeof vi.fn>
} {
  const discover = options.discoverReject !== undefined
    ? vi.fn().mockRejectedValue(options.discoverReject)
    : options.discoverRefused === true
      ? vi.fn().mockResolvedValue({
        rpcId: 'x',
        result: { ok: false as const, error: { code: 'model-discovery-failed', message: 'nope', details: { settingsNs: 'llm-deepseek' } } },
      })
      : vi.fn().mockResolvedValue(okEnvelope({ models: options.models ?? [] }))
  const describe = options.describeReject !== undefined
    ? vi.fn().mockRejectedValue(options.describeReject)
    : options.describeRefused === true
      ? vi.fn().mockResolvedValue({
        rpcId: 'x',
        result: { ok: false as const, error: { code: 'internal', message: 'x', details: {} } },
      })
      : vi.fn().mockResolvedValue(okEnvelope({
        writable: true,
        hasDocument: false,
        namespaces: options.storedModels !== undefined
          ? [{ ns: 'llm-deepagens', value: { models: options.storedModels }, revision: 0 }]
          : [],
      }))
  const mutate = vi.fn().mockResolvedValue(okEnvelope({ writable: true, hasDocument: false, namespaces: [] }))
  return {
    api: {
      llm: { discoverModels: discover },
      settings: { describe, mutate },
    } as unknown as Pick<ConnectionHandle['api'], 'llm' | 'settings'>,
    discover,
    describe,
    mutate,
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

const discovered: DiscoveredModelView[] = [
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

    expect(mock.discover).toHaveBeenCalledWith({
      settingsNs: 'llm-deepagens',
      baseURL: 'https://claw.deepagens.com/v1',
      apiKey: 'sk-test',
    })
    expect(mock.mutate).toHaveBeenCalledWith({
      ns: 'llm-deepagens',
      ops: [
        { op: 'set', path: ['baseURL'], value: 'https://claw.deepagens.com/v1' },
        { op: 'set', path: ['models'], value: expectedModels },
      ],
    })
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

    expect(mock.mutate).toHaveBeenCalledWith({
      ns: 'llm-deepagens',
      ops: [
        { op: 'set', path: ['baseURL'], value: 'https://claw.deepagens.com/v1' },
        { op: 'set', path: ['models'], value: expectedModels },
      ],
    })
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
})
