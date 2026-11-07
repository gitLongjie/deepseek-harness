// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_GATEWAY_IMAGE_MODEL,
  LoginStore,
  type LoginApi,
  type LoginCredentialAdapter,
  type LoginSession,
} from '../src/client/login-store.ts'

const AUTH_URL = 'https://claw.deepagens.com/api/claw/login'

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
  /** The `baseURL` value the settings read reports; `undefined` leaves the field absent. */
  storedBaseURL?: unknown
  /**
   * The `followGatewayCatalog` value the settings read reports; `undefined`
   * leaves the field absent (the login flow's default, `true`, applies).
   */
  storedFollowGateway?: boolean
  /**
   * The `imageModel` value the settings read reports; `undefined` leaves the
   * field absent so login seeds {@link DEFAULT_GATEWAY_IMAGE_MODEL}.
   */
  storedImageModel?: unknown
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
            ...(options.storedModels !== undefined || options.storedBaseURL !== undefined
              || options.storedFollowGateway !== undefined
              || options.storedImageModel !== undefined
              ? [{
                ns: 'llm-deepagens',
                value: {
                  ...options.storedBaseURL === undefined ? {} : { baseURL: options.storedBaseURL },
                  ...options.storedModels === undefined ? {} : { models: options.storedModels },
                  ...options.storedFollowGateway === undefined ? {} : { followGatewayCatalog: options.storedFollowGateway },
                  ...options.storedImageModel === undefined ? {} : { imageModel: options.storedImageModel },
                },
                revision: 0,
              }]
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
  { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', inputModalities: ['text', 'image'] },
  { id: 'image-only', name: 'image-only', inputModalities: ['file', 'image', 'image'] as NonNullable<LlmDiscoveredModel['inputModalities']> },
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
    inputModalities: ['text'],
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'deepseek-v4.1-flash',
    description: '',
    inputModalities: ['text', 'image'],
  },
  {
    id: 'image-only',
    name: 'image-only',
    description: '',
    inputModalities: ['text', 'image'],
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
        { op: 'set', path: ['imageModel'], value: DEFAULT_GATEWAY_IMAGE_MODEL },
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

  it('stores a gateway listing without declared capacities as capacity-less rows', async () => {
    const mock = mockApi({ models: [{ id: 'silent-model', name: 'silent-model' }] })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).toHaveBeenCalledWith(
      'llm-deepagens',
      [
        { op: 'set', path: ['baseURL'], value: 'https://claw.deepagens.com/v1' },
        {
          op: 'set',
          path: ['models'],
          value: [{ id: 'silent-model', name: 'silent-model', description: '', inputModalities: ['text'] }],
        },
        { op: 'set', path: ['imageModel'], value: DEFAULT_GATEWAY_IMAGE_MODEL },
      ],
      undefined,
    )
  })

  it('writes when the stored catalog differs', async () => {
    const mock = mockApi({
      models: discovered,
      storedModels: [{ id: 'old-model' }],
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
    })
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

  it('skips the write when the endpoint, catalog, and imageModel are unchanged', async () => {
    const mock = mockApi({
      models: discovered,
      storedModels: expectedModels,
      storedBaseURL: 'https://claw.deepagens.com/v1',
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).not.toHaveBeenCalled()
  })

  it('seeds imageModel when settings omit it and the catalog is otherwise unchanged', async () => {
    const mock = mockApi({
      models: discovered,
      storedModels: expectedModels,
      storedBaseURL: 'https://claw.deepagens.com/v1',
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).toHaveBeenCalledWith(
      'llm-deepagens',
      [{ op: 'set', path: ['imageModel'], value: DEFAULT_GATEWAY_IMAGE_MODEL }],
      0,
    )
  })

  it('stores tagged image-generation rows and points imageModel at the first one', async () => {
    const mock = mockApi({
      models: [
        { id: 'flux-1', name: 'Flux 1', imageGeneration: true },
        ...discovered,
        { id: 'seedream-4', name: 'Seedream 4', imageGeneration: true },
      ],
      storedBaseURL: 'https://claw.deepagens.com/v1',
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
      storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' },
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).toHaveBeenCalledWith(
      'llm-deepagens',
      [
        {
          op: 'set',
          path: ['models'],
          value: [
            { id: 'flux-1', name: 'Flux 1', description: '', inputModalities: ['text'], endpoint: 'image-generation' },
            ...expectedModels,
            { id: 'seedream-4', name: 'Seedream 4', description: '', inputModalities: ['text'], endpoint: 'image-generation' },
          ],
        },
        { op: 'set', path: ['imageModel'], value: 'flux-1' },
      ],
      0,
    )
    expect(mock.replace).toHaveBeenCalledWith(
      'agent-default-model',
      { provider: 'deepagens', model: 'gpt-4o' },
      2,
    )
  })

  it('keeps a stored imageModel the gateway still tags', async () => {
    const tagged = { id: 'seedream-4', name: 'Seedream 4', description: '', inputModalities: ['text'], endpoint: 'image-generation' }
    const mock = mockApi({
      models: [...discovered, { id: 'seedream-4', name: 'Seedream 4', imageGeneration: true }],
      storedModels: [...expectedModels, tagged],
      storedBaseURL: 'https://claw.deepagens.com/v1',
      storedImageModel: 'seedream-4',
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).not.toHaveBeenCalled()
  })

  it('keeps a stored imageModel instead of reseeding', async () => {
    const mock = mockApi({
      models: discovered,
      storedModels: expectedModels,
      storedBaseURL: 'https://claw.deepagens.com/v1',
      storedImageModel: 'custom-image',
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).not.toHaveBeenCalled()
  })

  it('re-points the endpoint when discovery is refused', async () => {
    const mock = mockApi({
      models: discovered,
      discoverRefused: true,
      storedModels: expectedModels,
      storedBaseURL: 'http://localhost:31000/v1',
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).toHaveBeenCalledWith(
      'llm-deepagens',
      [{ op: 'set', path: ['baseURL'], value: 'https://claw.deepagens.com/v1' }],
      0,
    )
    expect(mock.replace).not.toHaveBeenCalled()
  })

  it('seeds imageModel when discovery is refused and settings omit it', async () => {
    const mock = mockApi({
      models: discovered,
      discoverRefused: true,
      storedModels: expectedModels,
      storedBaseURL: 'https://claw.deepagens.com/v1',
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.mutate).toHaveBeenCalledWith(
      'llm-deepagens',
      [{ op: 'set', path: ['imageModel'], value: DEFAULT_GATEWAY_IMAGE_MODEL }],
      0,
    )
  })

  it('keeps the sign-in when discovery rejects', async () => {
    const mock = mockApi({
      models: discovered,
      discoverReject: new Error('boom'),
      storedBaseURL: 'https://claw.deepagens.com/v1',
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
    })
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
      storedBaseURL: 'https://claw.deepagens.com/v1',
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
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
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
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
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
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
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
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
      storedImageModel: DEFAULT_GATEWAY_IMAGE_MODEL,
      storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' },
      replaceRefused: true,
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)
    expect(store.store.getSnapshot().session?.account).toBe('User')
  })

  it('keeps the user-managed endpoint, catalog, and default when follow is disabled', async () => {
    const mock = mockApi({
      models: discovered,
      storedModels: [{ id: 'old-model' }],
      storedBaseURL: 'http://127.0.0.1:3000/v1',
      storedFollowGateway: false,
      storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' },
    })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.discover).not.toHaveBeenCalled()
    expect(mock.mutate).not.toHaveBeenCalled()
    expect(mock.replace).not.toHaveBeenCalled()
  })

  it('skips the default adoption when discovery lists no models', async () => {
    const mock = mockApi({ models: [], storedDefault: { provider: 'deepseek-official', model: 'deepseek-flash' } })
    okLogin()

    const store = new LoginStore(AUTH_URL, adapter(), mock.api)
    await expect(store.login('u', 'p')).resolves.toBe(true)

    expect(mock.replace).not.toHaveBeenCalled()
  })
})
