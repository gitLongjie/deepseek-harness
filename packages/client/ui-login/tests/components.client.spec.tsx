// @vitest-environment jsdom
/** Component behavior of the sign-in gate and the sidebar account row. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LoginGate } from '../src/client/LoginGate.tsx'
import { SidebarAccount } from '../src/client/SidebarAccount.tsx'
import { LoginStore, type LoginCredentialAdapter } from '../src/client/login-store.ts'

// Minimal API mock for the LoginStore constructor: discovery returns an empty
// catalog and the settings read reports no namespaces.
const okEnvelope = <T,>(value: T): { rpcId: unknown; result: { ok: true; value: T } } => ({
  rpcId: 'x',
  result: { ok: true, value },
})

const dummyApi = {
  llm: { discoverModels: vi.fn().mockResolvedValue(okEnvelope({ models: [] })) },
  settings: {
    describe: vi.fn().mockResolvedValue(okEnvelope({ writable: true, hasDocument: false, namespaces: [] })),
    mutate: vi.fn().mockResolvedValue(okEnvelope({ writable: true, hasDocument: false, namespaces: [] })),
  },
} as unknown as Pick<ConnectionHandle['api'], 'llm' | 'settings'>
import { zh, type LoginKey } from '../src/client/locales.ts'

const t = (key: LoginKey): string => zh[key]

const inertAdapter: LoginCredentialAdapter = {
  async apply() {},
  async clear() {},
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

function clawResponse(): Response {
  return new Response(JSON.stringify({
    success: true,
    data: { display_name: '杰哥', avatar: 'https://claw.deepagens.com/a.png', api_key: 'sk-1' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('LoginGate', () => {
  it('renders nothing while signed in and before hydration', () => {
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: '杰哥', avatar: null, apiKey: 'sk-1' }))
    const signedIn = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    signedIn.load()
    const { container } = render(<LoginGate controller={signedIn} t={t} />)
    expect(container.childElementCount).toBe(0)
    const unhydrated = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    const { container: lazy } = render(<LoginGate controller={unhydrated} t={t} />)
    expect(lazy.childElementCount).toBe(0)
  })

  it('submits the typed pair and follows the busy → signed-in flip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clawResponse()))
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    controller.load()
    const { container } = render(<LoginGate controller={controller} t={t} />)
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'jiege' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'pw' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => { expect(container.childElementCount).toBe(0) })
    expect(controller.store.getSnapshot().session?.account).toBe('杰哥')
  })

  it('keeps the card up with the server message on a refused pair', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false, message: '用户名或密码错误',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    controller.load()
    render(<LoginGate controller={controller} t={t} />)
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'jiege' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'bad' } })
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('用户名或密码错误') })
  })
})

describe('SidebarAccount', () => {
  it('renders the avatar and name when signed in wide', () => {
    localStorage.setItem('dsh.login.session', JSON.stringify({
      account: '杰哥', avatar: 'https://claw.deepagens.com/a.png', apiKey: 'sk-1',
    }))
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    controller.load()
    const { container } = render(<SidebarAccount wide controller={controller} t={t} />)
    expect(screen.getByText('杰哥')).toBeDefined()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://claw.deepagens.com/a.png')
  })

  it('falls back to the initial and hides the name in rail mode', () => {
    localStorage.setItem('dsh.login.session', JSON.stringify({ account: 'jiege', avatar: null, apiKey: 'sk-1' }))
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    controller.load()
    const { container } = render(<SidebarAccount wide={false} controller={controller} t={t} />)
    expect(screen.queryByText('jiege')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('J')).toBeDefined()
  })

  it('renders nothing while signed out', () => {
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    controller.load()
    const { container } = render(<SidebarAccount wide controller={controller} t={t} />)
    expect(container.childElementCount).toBe(0)
  })
})
