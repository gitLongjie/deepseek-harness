// @vitest-environment jsdom
/** Component behavior of the sign-in gate and the sidebar account row. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LoginGate } from '../src/client/LoginGate.tsx'
import { SidebarAccount } from '../src/client/SidebarAccount.tsx'
import { LoginStore, type LoginApi, type LoginCredentialAdapter } from '../src/client/login-store.ts'

// Minimal API mock for the LoginStore constructor: discovery returns an empty
// catalog and the settings read reports no namespaces.
const okResult = <T,>(value: T): { ok: true; value: T } => ({ ok: true, value })

const dummyApi: LoginApi = {
  llm: { discoverModels: vi.fn().mockResolvedValue(okResult([])) },
  settings: {
    describe: vi.fn().mockResolvedValue(okResult({ writable: true, hasDocument: false, namespaces: [] })),
    mutate: vi.fn().mockResolvedValue(okResult({ revision: 1 })),
    replace: vi.fn().mockResolvedValue(okResult({ revision: 1 })),
  },
}
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

/**
 * Drive a successful sign-in against a stubbed Claw endpoint: the store's
 * real wire path, so the session under test is the one a login produces.
 */
async function signIn(
  controller: LoginStore,
  data: Record<string, unknown> = { display_name: '杰哥', avatar: 'https://claw.deepagens.com/a.png', api_key: 'sk-1' },
): Promise<void> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ success: true, data }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  await act(async () => { await controller.login('jiege', 'pw') })
}

describe('LoginGate', () => {
  it('leaves the desktop shell top inset visible', () => {
    const styles = readFileSync(resolve('packages/client/ui-login/src/client/LoginGate.module.css'), 'utf8')
    expect(styles).toContain('top: var(--dsh-shell-top-inset, 0px);')
  })

  it('renders nothing while signed in', async () => {
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    await signIn(controller)
    const { container } = render(<LoginGate controller={controller} brandIcon="/brand/acme.svg" t={t} />)
    expect(container.childElementCount).toBe(0)
  })

  it('covers the app with the backdrop while the boot re-login is in flight, then yields', async () => {
    let release!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolveResponse) => { release = resolveResponse })))
    localStorage.setItem('dsh.login.pair', JSON.stringify({ username: 'jiege', password: 'pw' }))
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    const pending = controller.restore()
    const { container } = render(<LoginGate controller={controller} brandIcon="/brand/acme.svg" t={t} />)
    // No card flash while the stored pair is being replayed.
    expect(container.childElementCount).toBe(1)
    expect(container.querySelector('form')).toBeNull()
    release(new Response(JSON.stringify({
      success: true, data: { display_name: '杰哥', avatar: null, api_key: 'sk-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await act(async () => { await pending })
    expect(container.childElementCount).toBe(0)
    expect(controller.store.getSnapshot().session?.account).toBe('杰哥')
  })

  it('submits the typed pair and follows the busy → signed-in flip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { display_name: '杰哥', avatar: 'https://claw.deepagens.com/a.png', api_key: 'sk-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    const { container } = render(<LoginGate controller={controller} brandIcon="/brand/acme.svg" t={t} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/brand/acme.svg')
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
    render(<LoginGate controller={controller} brandIcon="/brand/acme.svg" t={t} />)
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'jiege' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'bad' } })
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('用户名或密码错误') })
  })

  it('reveals and re-hides the password through the eye toggle', () => {
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    render(<LoginGate controller={controller} brandIcon="/brand/acme.svg" t={t} />)
    const password = screen.getByLabelText('密码') as HTMLInputElement
    expect(password.getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    expect(password.getAttribute('type')).toBe('text')
    expect(screen.queryByRole('button', { name: '显示密码' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }))
    expect(password.getAttribute('type')).toBe('password')
  })
})

describe('SidebarAccount', () => {
  it('renders the avatar and name when signed in wide', async () => {
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    await signIn(controller)
    const { container } = render(<SidebarAccount wide controller={controller} t={t} />)
    expect(screen.getByText('杰哥')).toBeDefined()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://claw.deepagens.com/a.png')
  })

  it('falls back to the initial and hides the name in rail mode', async () => {
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    await signIn(controller, { api_key: 'sk-1' })
    const { container } = render(<SidebarAccount wide={false} controller={controller} t={t} />)
    expect(screen.queryByText('jiege')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('J')).toBeDefined()
  })

  it('renders nothing while signed out', () => {
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    const { container } = render(<SidebarAccount wide controller={controller} t={t} />)
    expect(container.childElementCount).toBe(0)
  })

  it('closes the popped-open menu across a sign-out → sign-in cycle', async () => {
    const controller = new LoginStore('https://claw.deepagens.com/api', inertAdapter, dummyApi)
    await signIn(controller)
    render(<SidebarAccount wide controller={controller} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '杰哥' }))
    expect(screen.getByRole('menu')).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
    // Signed out: the row unmounts and the dropdown with it.
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByText('杰哥')).toBeNull()
    // The next sign-in must open on a closed menu, not the previous session's.
    await signIn(controller)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByText('杰哥')).toBeDefined()
  })
})
