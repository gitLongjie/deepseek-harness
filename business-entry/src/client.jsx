/**
 * Business-entry plugin, browser half: one registration into the sidebar
 * shell's `sidebar.business` hole plus the `business` dictionaries. The
 * occupant is self-contained — a menu over a static catalog — so it declares
 * no inject face; its disclosure and selection ride the entry's declared
 * store, which outlives the shell unmounting the browsing region's wide
 * content at collapse.
 *
 * Hot-toggle: the Settings page carries a resident enable/disable switch for
 * the group (shell-owned, always visible). Toggling writes the home patch
 * (persisted) and fires a CustomEvent that the apply closure listens for to
 * dispose or re-create the sidebar.business slot registration immediately.
 */
import React from 'react'
import { BUSINESS_ENTRIES } from './entries.js'
import { en, zh } from './locales.js'
import { createBusinessEntryStore } from './stores.js'
import { css, stylesheet } from './styles.js'

/* ------------------------------------------------------------------ */
/*  Icons (inlined SVG to avoid depending on ui-primitives)           */
/* ------------------------------------------------------------------ */

function IconChevronDown({ size = 14, className }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 14 14', fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg', className,
  }, React.createElement('path', {
    d: 'M3.5 5.25L7 8.75L10.5 5.25', stroke: 'currentColor',
    strokeWidth: '1.2', strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
}

function IconListPen({ size = 16, className }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg', className,
  }, React.createElement('path', {
    d: 'M2.5 4h7M2.5 8h5M2.5 12h3M10 9.5l3-3 1.5 1.5-3 3H10V9.5z',
    stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
}

/* ------------------------------------------------------------------ */
/*  clsx helper (inlined to avoid external dependency)                */
/* ------------------------------------------------------------------ */

function clsx(...args) {
  let result = ''
  for (const arg of args) {
    if (!arg) continue
    if (typeof arg === 'string') { result += (result ? ' ' : '') + arg; continue }
    if (Array.isArray(arg)) { const inner = clsx(...arg); if (inner) result += (result ? ' ' : '') + inner; continue }
    if (typeof arg === 'object') {
      for (const key in arg) {
        if (Object.prototype.hasOwnProperty.call(arg, key) && arg[key]) {
          result += (result ? ' ' : '') + key
        }
      }
    }
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  BusinessNav component                                             */
/* ------------------------------------------------------------------ */

function BusinessNav({ wide, expandSidebar, useStore, actions, t }) {
  const expanded = useStore(s => s.expanded)
  const selected = useStore(s => s.selected)

  if (!wide) {
    return React.createElement('div', { className: css.rail },
      React.createElement('button', {
        type: 'button',
        className: css.railButton,
        'aria-label': t('section.business'),
        onClick: () => { expandSidebar(); actions.setExpanded(true) },
      }, React.createElement(IconListPen, { size: 18 })),
    )
  }

  return React.createElement('div', { className: css.root },
    React.createElement('button', {
      type: 'button',
      className: css.header,
      'aria-expanded': expanded,
      onClick: () => { actions.setExpanded(!expanded) },
    },
      React.createElement(IconListPen, { size: 14, className: css.headerIcon }),
      React.createElement('span', { className: css.headerLabel }, t('section.business')),
      React.createElement(IconChevronDown, {
        className: clsx(css.chevron, !expanded && css.chevronCollapsed),
      }),
    ),
    expanded && React.createElement('ul', { className: css.items },
      BUSINESS_ENTRIES.map(entry =>
        React.createElement('li', { key: entry.id },
          React.createElement('button', {
            type: 'button',
            className: clsx(css.item, selected === entry.id && css.itemActive),
            'aria-current': selected === entry.id ? 'true' : undefined,
            onClick: () => { actions.select(entry.id) },
          },
            React.createElement('span', {
              className: css.dot,
              style: { background: entry.dot },
            }),
            t(entry.label),
          ),
        ),
      ),
    ),
  )
}

/* ------------------------------------------------------------------ */
/*  Hot-toggle event name                                             */
/* ------------------------------------------------------------------ */

/** CustomEvent detail: `{ enabled: boolean }`. */
const TOGGLE_EVENT = 'dsh-business-entry:toggle'

const PLUGIN_ID = 'xmanrui-dsh-business-entry'

/* ------------------------------------------------------------------ */
/*  Plugin contract                                                   */
/* ------------------------------------------------------------------ */

const NS = 'business'

export const inject = ['slots', 'locale']

export function apply(ctx) {
  // Inject stylesheets once.
  if (typeof document !== 'undefined') {
    if (!document.querySelector('style[data-plugin="dsh-business-entry"]')) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-business-entry'
      tag.textContent = stylesheet
      document.head.appendChild(tag)
    }
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-business-entry: dictionaries')

  // Resolve defineStore from the client-store module through the module table.
  const clientStore = require('@deepseek-ai/dsh-client-store')
  const defineStore = clientStore.defineStore

  // --- Hot-toggleable sidebar.business slot ---
  // Holds the current inject disposer (which owns the register disposer).
  let sidebarDisposer = null

  function registerSidebar() {
    if (sidebarDisposer) return // already registered
    sidebarDisposer = ctx.slots.inject('sidebar.business', () => ctx.slots.register(
      {
        name: 'sidebar.business',
        store: createBusinessEntryStore(defineStore),
        locale: NS,
      },
      BusinessNav,
    ))
  }

  function unregisterSidebar() {
    if (sidebarDisposer) {
      sidebarDisposer()
      sidebarDisposer = null
    }
  }

  // Check initial enabled state via IPC, then register or skip.
  const ipc = typeof window !== 'undefined' ? window.__DSH_IPC__ : undefined
  if (ipc) {
    ipc.invoke('dsh:plugin:isEnabled', PLUGIN_ID).then(enabled => {
      if (enabled) registerSidebar()
    }).catch(() => {
      // IPC failure (e.g. web mode) → default enabled.
      registerSidebar()
    })
  } else {
    // No IPC (pure web) → always enabled.
    registerSidebar()
  }

  // Listen for hot-toggle events from the resident Settings toggle.
  function onToggle(event) {
    if (event.detail?.enabled) {
      registerSidebar()
    } else {
      unregisterSidebar()
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener(TOGGLE_EVENT, onToggle)
  }

  // Cleanup on plugin dispose: remove sidebar slot and event listener.
  ctx.effect(() => {
    return () => {
      unregisterSidebar()
      if (typeof window !== 'undefined') {
        window.removeEventListener(TOGGLE_EVENT, onToggle)
      }
    }
  }, 'dsh-business-entry: hot-toggle lifecycle')
}
