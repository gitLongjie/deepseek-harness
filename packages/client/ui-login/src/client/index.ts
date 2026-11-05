/**
 * Login gate plugin, browser half. When the build carries an account-server
 * endpoint (`DSH_CLIENT_LOGIN_URL`), it registers the full-page sign-in
 * takeover into the layout's overlay seat, the account launcher (avatar +
 * display name, with the settings-shell menu) into the settings shell's
 * launcher seat, and the gateway account page (identity + balance) into the
 * settings shell's section list — the launcher and the section shadow their
 * upstream DeepSeek counterparts at a lower priority. A launch revalidates
 * the key the last sign-in issued and
 * enters the app when the gateway still accepts it; a refused key replays the
 * stored account pair, which is the only path that creates a server-side
 * login session. A successful sign-in writes the issued key into the host
 * credential layer through the existing `credentials.set` wire method, under
 * the gateway route's own reference (`DEEPAGENS_API_KEY`) rather than the
 * DeepSeek route's `DEEPSEEK_API_KEY`.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.overlay' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.launcher' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LoginGate } from './LoginGate.tsx'
import { SidebarAccount } from './SidebarAccount.tsx'
import { GatewayAccountSection } from './GatewayAccountSection.tsx'
import { LoginStore } from './login-store.ts'
import { GATEWAY_CREDENTIAL_REF, type LoginCredentialAdapter } from './login-store.ts'
import { en, zh, type LoginKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'login'

/**
 * The account server's login endpoint this deployment ships against (an
 * external service address, like the LLM adapter's public base URL). A build
 * overrides it with `DSH_CLIENT_LOGIN_URL`; setting that variable to an empty
 * string compiles the gate out entirely.
 */
const DEFAULT_LOGIN_URL = 'https://claw.deepagens.com/api/claw/login'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The sign-in gate + account row copy. */
    'login': LoginKey
  }
}

/**
 * Credential adapter over the connection's credentials domain: the sign-in
 * result lands in the same writable layer the Models settings page uses, but
 * under the gateway route's own reference, so the DeepSeek route's stored key
 * survives every launch-time re-login.
 */
function credentialAdapter(remote: ClientRemote): LoginCredentialAdapter {
  const assertOk = (result: { ok: boolean; error?: { message: string } }): void => {
    if (!result.ok) throw new Error(result.error?.message ?? 'credential write refused')
  }
  return {
    async apply(session) {
      assertOk(await remote.credentials.set(GATEWAY_CREDENTIAL_REF, session.apiKey))
    },
    async clear() {
      assertOk(await remote.credentials.unset(GATEWAY_CREDENTIAL_REF))
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
  const brandName = process.env.DSH_CLIENT_BRAND_NAME ?? '喵工作台'
  ctx.effect(() => ctx.locale.register(NS, {
    zh: {
      ...zh,
      pageTitle: `登录${brandName}`,
      tagline: process.env.DSH_CLIENT_LOGIN_TAGLINE_ZH ?? zh.tagline,
    },
    en: {
      ...en,
      pageTitle: `Sign in to ${brandName}`,
      tagline: process.env.DSH_CLIENT_LOGIN_TAGLINE_EN ?? en.tagline,
    },
  }), 'ui-login: copy dictionaries')

  const remote = ctx.get('remote') as ClientRemote
  const controller = new LoginStore(authUrl, credentialAdapter(remote), {
    llm: remote.llm,
    settings: remote.settings,
  })
  // Boot-time restore: a stored key the gateway still accepts signs in
  // without a new login session; only a refused key replays the stored pair.
  // Either way the gate shows only its backdrop while this runs.
  void controller.restore()
  const t = ctx.locale.bind(NS) as (key: LoginKey) => string
  const brandIcon = process.env.DSH_CLIENT_BRAND_ICON ?? '/favicon.svg'

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'login-gate', inject: () => ({ controller, brandIcon, t }) },
    LoginGate,
  ))
  // Shadowing priority below the settings-account launcher (default 0): this
  // deployment's account row renders the claw gateway session, and the slots
  // shadowing rule (lowest renders) retires the upstream DeepSeek launcher
  // where both compositions meet — upstream compositions without this plugin
  // keep their launcher untouched.
  ctx.slots.inject('settings.launcher', () => ctx.slots.register(
    { name: 'settings.launcher', priority: -1, inject: () => ({ controller, t }) },
    SidebarAccount,
  ))
  // The settings 账号与余额 page, shadowing the upstream DeepSeek account
  // section the same way the launcher is shadowed: same section id
  // (`account`), lower priority (list cells render their lowest live entry),
  // same nav order. Live only while a gateway session is signed in — signed
  // out, the upstream page (or no page, without a DeepSeek credential) serves
  // the cell again, exactly as before this plugin existed.
  ctx.slots.inject('settings.section', () => {
    let unregister: (() => void) | undefined
    const update = (): void => {
      if (controller.store.getSnapshot().session !== null) {
        unregister ??= ctx.slots.register({
          name: 'settings.section', id: 'account', order: -10, priority: -1,
          label: () => t('accountNav'), locale: NS, inject: () => ({ controller, t }),
        }, GatewayAccountSection)
      } else {
        unregister?.()
        unregister = undefined
      }
    }
    const offStore = controller.store.subscribe(update)
    update()
    return () => { offStore(); unregister?.() }
  })
}
