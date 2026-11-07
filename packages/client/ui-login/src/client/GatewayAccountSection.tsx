/**
 * Settings account section for the gateway session: the signed-in account
 * identity and the gateway token quota (used and remaining). Registered into
 * the settings shell's `settings.section` seat at the shadowing priority, so it
 * renders in place of the upstream DeepSeek account page wherever the two
 * compositions meet; builds without this plugin keep the upstream page.
 * Token counts come from the shared login store, which reads the gateway's
 * token-usage endpoint with the session key.
 */

import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LoginKey } from './locales.ts'
import type { LoginStore } from './login-store.ts'
import css from './GatewayAccountSection.module.css'

/** Inject face the registration supplies to the account section. */
export interface GatewayAccountSectionInjected {
  /** The session store coordinator; its balance state drives the token rows. */
  controller: LoginStore
  /** Locale seat bound to the login namespace. */
  t: (key: LoginKey) => string
}

/** Props of the account section: the seat's owner share plus the inject face. */
export type GatewayAccountSectionProps =
  & SettingsSectionOwnerProps
  & GatewayAccountSectionInjected

/**
 * Group a token count with thousands separators. The count itself is not copy;
 * the row label carries the unit.
 * @param count - a non-negative token count from the gateway.
 * @returns the grouped decimal representation.
 */
function formatTokenCount(count: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(count)
}

/**
 * Render the gateway session identity and its token quota. Each mount
 * schedules a re-read, so every entry into the settings page refreshes the
 * counts the way the upstream account page re-reads its wallets on entry.
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
  const pending = balance === null || balance.status === 'loading'
  const ready = balance?.status === 'ready' ? balance : null
  const tokenValue = (kind: 'used' | 'remaining'): ReactNode => {
    if (pending) return <span className={css.unavailable}>{t('balanceLoading')}</span>
    if (ready === null) {
      return kind === 'used'
        ? <button type="button" className={css.retry} onClick={() => { void controller.refreshBalance() }}>
          {t('balanceRetry')}
        </button>
        : <span className={css.unavailable}>{t('balanceUnavailable')}</span>
    }
    if (kind === 'remaining' && ready.unlimited) return <span className={css.amount}>{t('unlimitedTokens')}</span>
    const count = kind === 'used' ? ready.usedTokens : ready.remainingTokens
    return <span className={css.amount}>{formatTokenCount(count)}</span>
  }
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
          <span>{t('usedTokens')}</span>
          {tokenValue('used')}
        </div>
        <div className={css.divider} />
        <div className={css.row}>
          <span>{t('remainingTokens')}</span>
          {tokenValue('remaining')}
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
