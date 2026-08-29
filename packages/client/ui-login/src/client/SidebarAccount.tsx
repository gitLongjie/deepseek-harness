/**
 * Sidebar-foot account row: the signed-in avatar and display name, with a
 * dropdown carrying the sign-out action. Rendered into the host-declared
 * `sidebar.footer.action` seat beside Settings.
 */

import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { LoginKey } from './locales.ts'
import type { LoginStore } from './login-store.ts'
import css from './SidebarAccount.module.css'

/** Inject face the registration supplies to the account row. */
export interface SidebarAccountInjected {
  controller: LoginStore
  t: (key: LoginKey) => string
}

/** Props of the account row: the seat's owner share plus the locale seat. */
export type SidebarAccountProps =
  & SidebarFooterActionOwnerProps
  & SidebarAccountInjected
  & { t: (key: LoginKey) => string }

/**
 * Render the account row against the sidebar column state; hidden entirely
 * while signed out (the sign-in gate covers the app then).
 * @param props.wide - whether the sidebar renders wide content (false = rail).
 * @param props.controller - the session store coordinator.
 * @param props.t - locale seat bound to the login namespace.
 * @returns the row, or null while signed out.
 */
export function SidebarAccount({ wide, controller, t }: SidebarAccountProps): ReactNode {
  const state = useSyncExternalStore(
    fn => controller.store.subscribe(fn),
    () => controller.store.getSnapshot(),
    () => controller.store.getSnapshot(),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const session = state.session
  if (session === null) return null
  const items: MenuEntry[] = [
    { id: 'logout', label: t('logout'), danger: true },
  ]
  return (
    <Menu
      open={menuOpen}
      onClose={() => { setMenuOpen(false) }}
      onSelect={(id) => { if (id === 'logout') controller.logout() }}
      items={items}
      // Portal + upward: the sidebar foot clips overflow and sits at the
      // column bottom, so an in-place downward list would be cut off.
      portal
      side="top"
      anchor={(
        <button
          type="button"
          className={css.row}
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
  )
}
