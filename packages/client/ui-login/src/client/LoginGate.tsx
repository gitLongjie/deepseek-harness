/**
 * Full-page sign-in takeover. Registered as a `shell.overlay` entry by this
 * plugin's apply when the build carries an account endpoint; it renders
 * nothing once the session is signed in, so the app underneath stays intact.
 */

import { useId, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, MewoLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoginKey } from './locales.ts'
import type { LoginStore } from './login-store.ts'
import css from './LoginGate.module.css'

/** Inject face the registration supplies to the gate component. */
export interface LoginGateInjected {
  controller: LoginStore
  t: (key: LoginKey) => string
}

/** Props of the sign-in gate (locale seat arrives via the registration). */
export type LoginGateProps = LoginGateInjected & { t: (key: LoginKey) => string }

/**
 * Render the sign-in card over an opaque backdrop that re-enables pointer
 * events (the overlay layer itself is click-through by design).
 * @param props.controller - the session store coordinator.
 * @param props.t - locale seat bound to the login namespace.
 * @returns the takeover, or null while signed in or not yet hydrated.
 */
export function LoginGate({ controller, t }: LoginGateProps): ReactNode {
  const state = useSyncExternalStore(
    fn => controller.store.subscribe(fn),
    () => controller.store.getSnapshot(),
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const usernameId = useId()
  const passwordId = useId()
  if (state.status !== 'ready' || state.session !== null) return null
  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (state.busy || username === '' || password === '') return
    void controller.login(username, password)
  }
  return (
    <div className={css.backdrop} role="presentation">
      <form className={css.card} onSubmit={onSubmit}>
        <MewoLogo size={48} className={css.logo} />
        <h1 className={css.title}>{t('pageTitle')}</h1>
        <p className={css.tagline}>{t('tagline')}</p>
        <label className={css.field} htmlFor={usernameId}>
          <span className={css.fieldLabel}>{t('username')}</span>
          <Input
            id={usernameId}
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => { setUsername(event.currentTarget.value) }}
          />
        </label>
        <label className={css.field} htmlFor={passwordId}>
          <span className={css.fieldLabel}>{t('password')}</span>
          <Input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => { setPassword(event.currentTarget.value) }}
          />
        </label>
        {state.error !== null && <p className={css.error} role="alert">{state.error}</p>}
        <Button
          className={css.submit}
          variant="primary"
          type="submit"
          disabled={state.busy || username === '' || password === ''}
        >
          {state.busy ? t('submitting') : t('submit')}
        </Button>
        <a className={css.register} href={`${controller.baseUrl()}/register`} target="_blank" rel="noreferrer">
          {t('register')}
        </a>
      </form>
    </div>
  )
}
