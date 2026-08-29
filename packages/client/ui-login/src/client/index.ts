/**
 * Login gate plugin, browser half. When the build carries an account-server
 * endpoint (`DSH_CLIENT_LOGIN_URL`), it registers the full-page sign-in
 * takeover into the layout's overlay seat and the account row (avatar +
 * display name + sign-out) into the sidebar's footer-action seat. A
 * successful sign-in writes the issued key and the server origin into the
 * host credential layer through the existing `credentials.set` wire method.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.overlay' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.footer.action' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LoginGate } from './LoginGate.tsx'
import { SidebarAccount } from './SidebarAccount.tsx'
import { LoginStore } from './login-store.ts'
import type { LoginCredentialAdapter } from './login-store.ts'
import { en, zh, type LoginKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'login'

/**
 * The account server's login endpoint this deployment ships against (an
 * external service address, like the LLM adapter's public base URL). A build
 * overrides it with `DSH_CLIENT_LOGIN_URL`; setting that variable to an empty
 * string compiles the gate out entirely.
 */
const DEFAULT_LOGIN_URL = 'https://claw.deepagens.com/api/user/deepagens-claw/login'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The sign-in gate + account row copy. */
    'login': LoginKey
  }
}

/**
 * Credential adapter over the connection's credentials domain: the sign-in
 * result lands in the same writable layer the Models settings page uses.
 */
function credentialAdapter(remote: ClientRemote): LoginCredentialAdapter {
  const assertOk = (result: { ok: boolean; error?: { message: string } }): void => {
    if (!result.ok) throw new Error(result.error?.message ?? 'credential write refused')
  }
  return {
    async apply(session, baseUrl) {
      assertOk(await remote.credentials.set('DEEPSEEK_API_KEY', session.apiKey))
      assertOk(await remote.credentials.set('DEEPSEEK_BASE_URL', baseUrl))
    },
    async clear() {
      assertOk(await remote.credentials.unset('DEEPSEEK_API_KEY'))
      assertOk(await remote.credentials.unset('DEEPSEEK_BASE_URL'))
    },
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings']

/**
 * Register the sign-in gate and the account row against this deployment's
 * account endpoint; a build that empties `DSH_CLIENT_LOGIN_URL` stays
 * untouched.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const override = process.env.DSH_CLIENT_LOGIN_URL
  const authUrl = override === '' ? '' : override ?? DEFAULT_LOGIN_URL
  if (authUrl === '') return
  console.warn(`[ui-login] applying login gate against ${authUrl}`)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-login: copy dictionaries')

  const remote = ctx.get('remote') as ClientRemote
  const controller = new LoginStore(authUrl, credentialAdapter(remote), {
    llm: remote.llm,
    settings: remote.settings,
  })
  controller.load()
  const t = ctx.locale.bind(NS) as (key: LoginKey) => string

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'login-gate', inject: () => ({ controller, t }) },
    LoginGate,
  ))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'login-account', inject: () => ({ controller, t }) },
    SidebarAccount,
  ))
}
