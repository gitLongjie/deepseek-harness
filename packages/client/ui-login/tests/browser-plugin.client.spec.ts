/** Login gate registration: env-gated apply, the credential adapter, and teardown. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { LoginGate } from '../src/client/LoginGate.tsx'
import { SidebarAccount } from '../src/client/SidebarAccount.tsx'

// The lane has no jsdom `window`, so a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); the bench stages zh explicitly instead.
afterEach(() => {
  vi.unstubAllEnvs()
})

function credentialCalls() {
  return { set: [] as Array<{ ref: string; value: string }>, unset: [] as string[] }
}

async function bench(calls = credentialCalls()) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  new TestRemote(ctx, {
    credentials: {
      set: async (ref: string, value: string) => {
        calls.set.push({ ref, value })
        return { ok: true as const, value: { ref } }
      },
      unset: async (ref: string) => {
        calls.unset.push(ref)
        return { ok: true as const, value: {} }
      },
    },
    llm: {
      discoverModels: async () => ({ ok: true as const, value: [] }),
    },
    settings: {
      describe: async () => ({ ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } }),
      mutate: async () => ({ ok: true as const, value: { revision: 1 } }),
    },
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, calls }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.overlay': { kind: 'list', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-login apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings'])
  })

  it('registers nothing when the build empties the login endpoint override', async () => {
    vi.stubEnv('DSH_CLIENT_LOGIN_URL', '')
    const subject = await bench()
    declare(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries('shell.overlay')).toHaveLength(0)
    expect(subject.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('falls back to the deployment default endpoint without an override', async () => {
    delete process.env.DSH_CLIENT_LOGIN_URL
    const subject = await bench()
    declare(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (subject.slots.entries('sidebar.footer.action')[0]!
      .inject as unknown as () => import('../src/client/SidebarAccount.tsx').SidebarAccountInjected)()
    expect(face.controller.baseUrl()).toBe('https://claw.deepagens.com')
    vi.unstubAllEnvs()
  })

  it('registers the gate and the account row with a bound locale seat', async () => {
    vi.stubEnv('DSH_CLIENT_LOGIN_URL', 'https://claw.deepagens.com/api/user/deepagens-claw/login')
    vi.stubEnv('DSH_CLIENT_BRAND_ICON', '/brand/oem-login.svg')
    vi.stubEnv('DSH_CLIENT_LOGIN_TAGLINE_ZH', '配置的登录副标题')
    vi.stubEnv('DSH_CLIENT_LOGIN_TAGLINE_EN', 'Configured login tagline')
    const subject = await bench()
    declare(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const overlay = subject.slots.entries('shell.overlay')
    expect(overlay).toHaveLength(1)
    expect(overlay[0]!.component).toBe(LoginGate)
    expect(overlay[0]!.options).toMatchObject({ id: 'login-gate' })
    const foot = subject.slots.entries('sidebar.footer.action')
    expect(foot).toHaveLength(1)
    expect(foot[0]!.component).toBe(SidebarAccount)
    expect(foot[0]!.options).toMatchObject({ id: 'login-account' })
    const injected = foot[0]!.inject as unknown as () => import('../src/client/SidebarAccount.tsx').SidebarAccountInjected
    const face = injected()
    expect(face.t('logout')).toBe('退出登录')
    expect(face.t('submit')).toBe('登录')
    expect(typeof face.controller.login).toBe('function')
    expect(face.controller.baseUrl()).toBe('https://claw.deepagens.com')
    const other = overlay[0]!.inject as unknown as () => import('../src/client/LoginGate.tsx').LoginGateInjected
    expect(other().controller).toBe(face.controller)
    expect(other().brandIcon).toBe('/brand/oem-login.svg')
    expect(other().t('tagline')).toBe('配置的登录副标题')
  })

  it('writes the issued key and origin through the credentials domain', async () => {
    vi.stubEnv('DSH_CLIENT_LOGIN_URL', 'https://claw.deepagens.com/api/user/deepagens-claw/login')
    const subject = await bench()
    declare(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (subject.slots.entries('sidebar.footer.action')[0]!
      .inject as unknown as () => import('../src/client/SidebarAccount.tsx').SidebarAccountInjected)()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { display_name: '杰哥', avatar: '', api_key: 'sk-9' },
    }), { status: 200 })))
    await expect(face.controller.login('jiege', 'pw')).resolves.toBe(true)
    expect(subject.calls.set).toEqual([
      { ref: 'DEEPSEEK_API_KEY', value: 'sk-9' },
      { ref: 'DEEPSEEK_BASE_URL', value: 'https://claw.deepagens.com' },
    ])
    face.controller.logout()
    await Promise.resolve()
    await Promise.resolve()
    expect(subject.calls.unset).toEqual(['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'])
    vi.unstubAllGlobals()
  })

  it('fills declarations made after apply and removes both occupants on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_LOGIN_URL', 'https://claw.deepagens.com/api/user/deepagens-claw/login')
    const subject = await bench()
    const disposeHoles = declare(subject.slots)
    disposeHoles()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(subject.slots.entries('shell.overlay')).toHaveLength(0)
    expect(subject.slots.entries('sidebar.footer.action')).toHaveLength(0)
    declare(subject.slots)
    await Promise.resolve()
    expect(subject.slots.entries('shell.overlay')).toHaveLength(1)
    expect(subject.slots.entries('sidebar.footer.action')).toHaveLength(1)
    await fiber.dispose()
    expect(subject.slots.entries('shell.overlay')).toHaveLength(0)
    expect(subject.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })
})
