/**
 * Sidebar account launcher: the signed-in avatar and display name on the
 * left, a settings gear on the right. The profile half opens the account
 * menu (sign-out); the gear opens the settings shell's panel through the
 * seat's `openSettings` command. Rendered into the settings shell's
 * `settings.launcher` seat, shadowing the upstream credential launcher.
 */

import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { IconSettingsOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsLauncherOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LoginKey } from './locales.ts'
import type { LoginStore } from './login-store.ts'
import css from './SidebarAccount.module.css'

/** Inject face the registration supplies to the account launcher. */
export interface SidebarAccountInjected {
  controller: LoginStore
  t: (key: LoginKey) => string
}

/** Props of the account launcher: the seat's owner share plus the inject face. */
export type SidebarAccountProps =
  & SettingsLauncherOwnerProps
  & SidebarAccountInjected

/**
 * Render the account launcher against the sidebar column state; hidden
 * entirely while signed out (the sign-in gate covers the app then).
 * @param props.wide - whether the sidebar renders wide content (false = rail).
 * @param props.openSettings - open the shell-owned settings panel.
 * @param props.controller - the session store coordinator.
 * @param props.t - locale seat bound to the login namespace.
 * @returns the launcher, or null while signed out.
 */
export function SidebarAccount({ wide, openSettings, controller, t }: SidebarAccountProps): ReactNode {
  const state = useSyncExternalStore(
    fn => controller.store.subscribe(fn),
    () => controller.store.getSnapshot(),
    () => controller.store.getSnapshot(),
  )
  const session = state.session
  // The dropdown is interaction state of one signed-in session; a session
  // transition (sign-out, a fresh sign-in) must not carry an open menu into
  // the next one. Resetting during render closes it before the first paint.
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuedSession, setMenuedSession] = useState(session)
  if (session !== menuedSession) {
    setMenuedSession(session)
    setMenuOpen(false)
  }
  if (session === null) return null
  const items: MenuEntry[] = [
    { id: 'logout', label: t('logout'), danger: true },
  ]
  // Fragment, not a wrapping row: the slot outlet uses display:contents, so
  // the profile anchor and the gear become sibling flex items of the settings
  // shell's trigger row instead of sharing one width:100% box.
  return (
    <>
      <Menu
        open={menuOpen}
        onClose={() => { setMenuOpen(false) }}
        onSelect={(id) => { if (id === 'logout') controller.logout() }}
        items={items}
        // Portal + upward: the sidebar foot clips overflow and sits at the
        // column bottom, so an in-place downward list would be cut off.
        portal
        side="top"
        className={css.anchor}
        anchor={(
          <button
            type="button"
            className={css.profile}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(previous => !previous) }}
          >
            {session.avatar !== null
              ? <img className={css.avatar} src={session.avatar} alt="" />
              : <span className={css.avatarFallback}>{session.account.slice(0, 1).toUpperCase()}</span>}
            {wide && <span className={css.name}>{session.account}</span>}
          </button>
        )}
      />
      {wide && (
        <button
          type="button"
          className={css.gear}
          aria-label={t('menuSettings')}
          title={t('menuSettings')}
          onClick={openSettings}
        >
          <IconSettingsOutlineMedium size={16} />
        </button>
      )}
    </>
  )
}
