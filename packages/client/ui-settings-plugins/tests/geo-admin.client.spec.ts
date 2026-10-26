/**
 * The 深度云海 card controller: the staged section fields, the fixed password
 * reference, and what the card shows when the credentials domain cannot answer.
 */
import { describe, expect, it, vi } from 'vitest'
import { RemoteError, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  GEO_ADMIN_NS, GEO_ADMIN_PASSWORD_REF, GeoAdminCardController, type GeoAdminSettings,
} from '../src/client/geo-admin-card-controller.ts'

/** The card plugin's context, scripted down to the credentials namespace. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

/**
 * A credentials domain that reports one state and accepts writes.
 * @param configured - whether the Host reports a stored password.
 * @param writable - whether the Host accepts writes for it.
 * @returns the scripted context and its spies.
 */
function credentialsApi(configuredValue: boolean, writable = true) {
  let configured = configuredValue
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { [GEO_ADMIN_PASSWORD_REF]: { configured, writable } },
  }))
  const set = vi.fn(() => {
    configured = true
    return Promise.resolve({ ok: true as const, value: undefined })
  })
  return { ctx: ctxWith({ credentials: { describe, set } }), describe, set }
}

/** A Host that accepts every settings write. */
function acceptingHost() {
  const host = stubSettingsScope<GeoAdminSettings>()
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({
      status: 'ready',
      writable: true,
      value: { ...host.scope.getSnapshot().value ?? {}, [field]: value },
      user: { ...host.scope.getSnapshot().user ?? {}, [field]: value },
    })
  })
  host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {} })
  return host
}

describe('GeoAdminCardController', () => {
  it('names the namespace and the fixed password reference', () => {
    expect(GEO_ADMIN_NS).toBe('geo-admin')
    expect(GEO_ADMIN_PASSWORD_REF).toBe('GEO_ADMIN_PASSWORD')
  })

  it('shows the committed section and whether a password is stored', async () => {
    const host = acceptingHost()
    const credentials = credentialsApi(true)
    const controller = new GeoAdminCardController(host.scope, credentials.ctx)
    host.publish({
      status: 'ready',
      writable: true,
      value: { baseUrl: 'http://localhost:8001', username: 'article-bot' },
      user: {},
    })

    await vi.waitFor(() => { expect(controller.inject().hooks.geoAdminCard.getSnapshot().passwordConfigured).toBe(true) })
    const state = controller.inject().hooks.geoAdminCard.getSnapshot()
    expect(state.fields.baseUrl?.text).toBe('http://localhost:8001')
    expect(state.fields.username?.text).toBe('article-bot')
    expect(state.password.text).toBe('')
    expect(state.passwordWritable).toBe(true)
    expect(state.available).toBe(true)
  })

  it('stages an edit and writes it on save', async () => {
    const host = acceptingHost()
    const credentials = credentialsApi(false)
    const controller = new GeoAdminCardController(host.scope, credentials.ctx)
    const face = controller.inject()
    face.edit('baseUrl', 'http://10.0.0.2:8001')

    expect(face.hooks.geoAdminCard.getSnapshot().dirty).toBe(true)
    face.save()

    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('baseUrl', 'http://10.0.0.2:8001') })
  })

  it('writes the staged password through the credentials domain and re-reads it', async () => {
    const host = acceptingHost()
    const credentials = credentialsApi(false)
    const controller = new GeoAdminCardController(host.scope, credentials.ctx)
    const face = controller.inject()
    face.edit('password', 's3cret')

    face.save()

    await vi.waitFor(() => {
      expect(credentials.set).toHaveBeenCalledWith(GEO_ADMIN_PASSWORD_REF, 's3cret')
    })
    await vi.waitFor(() => { expect(face.hooks.geoAdminCard.getSnapshot().passwordConfigured).toBe(true) })
  })

  it('treats an absent credential answer as unconfigured but writable', async () => {
    const host = acceptingHost()
    const describe = vi.fn(() => Promise.resolve({ ok: true as const, value: {} }))
    const controller = new GeoAdminCardController(host.scope, ctxWith({ credentials: { describe, set: vi.fn() } }))

    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    const state = controller.inject().hooks.geoAdminCard.getSnapshot()
    expect(state.passwordConfigured).toBe(false)
    expect(state.passwordWritable).toBe(true)
  })

  it('keeps the last answer when the credentials domain fails', async () => {
    const host = acceptingHost()
    const describe = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: { [GEO_ADMIN_PASSWORD_REF]: { configured: true, writable: true } } })
      .mockResolvedValue({ ok: false as const, error: new RemoteError('gateway/internal', 'down', {}) })
    const controller = new GeoAdminCardController(host.scope, ctxWith({ credentials: { describe, set: vi.fn() } }))

    await vi.waitFor(() => { expect(controller.inject().hooks.geoAdminCard.getSnapshot().passwordConfigured).toBe(true) })
    controller.refreshCredential(GEO_ADMIN_PASSWORD_REF)

    await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(2) })
    expect(controller.inject().hooks.geoAdminCard.getSnapshot().passwordConfigured).toBe(true)
  })

  it('ignores a change report for another reference', () => {
    const host = acceptingHost()
    const credentials = credentialsApi(false)
    const controller = new GeoAdminCardController(host.scope, credentials.ctx)

    controller.refreshCredential('DEEPSEEK_API_KEY')

    expect(credentials.describe).toHaveBeenCalledTimes(1)
  })
})
