/**
 * Settings account section for the gateway session: the signed-in account
 * identity and the gateway balance (remaining quota). Registered into the
 * settings shell's `settings.section` seat at the shadowing priority, so it
 * renders in place of the upstream DeepSeek account page wherever the two
 * compositions meet; builds without this plugin keep the upstream page.
 * Balance facts come from the shared login store, which reads the gateway's
 * billing endpoints with the session key.
 */

import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LoginKey } from './locales.ts'
import type { LoginStore } from './login-store.ts'
import css from './GatewayAccountSection.module.css'

/** Inject face the registration supplies to the account section. */
export interface GatewayAccountSectionInjected {
  /** The session store coordinator; its balance state drives the balance row. */
  controller: LoginStore
  /** Locale seat bound to the login namespace. */
  t: (key: LoginKey) => string
}

/** Props of the account section: the seat's owner share plus the inject face. */
export type GatewayAccountSectionProps =
  & SettingsSectionOwnerProps
  & GatewayAccountSectionInjected

/**
 * Render the gateway session identity and its balance. Each mount schedules a
 * balance re-read, so every entry into the settings page refreshes the number
 * the way the upstream account page re-reads its wallets on entry.
 * @param props.controller - the session store coordinator.
 * @param props.t - locale seat bound to the login namespace.
 * @returns the account section, or null while signed out (teardown frame;
 *   the sign-in gate covers the app and the registration is retired then).
 */
export function GatewayAccountSection({ controller, t }: GatewayAccountSectionProps): ReactNode {
  const state = useSyncExternalStore(
    fn => controller.store.subscribe(fn),
    () => controller.store.getSnapshot(),
    () => controller.store.getSnapshot(),
  )
  // A mount is one settings entry: refresh before the signed-out branch so
  // the hook order never depends on the session state.
  useEffect(() => { void controller.refreshBalance() }, [controller])
  const session = state.session
  if (session === null) return null
  const balance = state.balance
  const consoleUrl = `${controller.baseUrl()}/console`
  return (
    <section className={css.section} aria-label={t('accountNav')}>
      <div className={css.card}>
        <div className={css.identity}>
          <span className={css.avatar}>
            {session.avatar !== null
              ? <img className={css.avatarImage} src={session.avatar} alt="" />
              : <span>{session.account.slice(0, 1).toUpperCase()}</span>}
          </span>
          <div className={css.identityCopy}>
            <span className={css.name}>{session.account}</span>
            <span className={css.status}>{t('signedInToGateway')}</span>
          </div>
        </div>
      </div>
      <div className={css.balanceCard}>
        <div className={css.row}>
          <span>{t('balance')}</span>
          {balance === null || balance.status === 'loading'
            ? <span className={css.unavailable}>{t('balanceLoading')}</span>
            : balance.status === 'ready'
              ? <span className={css.amount}>{`$${balance.remainingUsd.toFixed(2)}`}</span>
              : <button type="button" className={css.retry} onClick={() => { void controller.refreshBalance() }}>
                {t('balanceRetry')}
              </button>}
        </div>
        <div className={css.divider} />
        <div className={css.row}>
          <span className={css.secondary}>{t('more')}</span>
          <div className={css.links}>
            <a className={css.linkButton} href={consoleUrl} target="_blank" rel="noreferrer">{t('openConsole')}</a>
            <a className={`${css.linkButton} ${css.primary}`} href={`${consoleUrl}/topup`} target="_blank" rel="noreferrer">
              {t('topUp')}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
