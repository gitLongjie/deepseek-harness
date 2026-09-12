/**
 * Business-entry plugin, browser half: one registration into the sidebar
 * shell's `sidebar.business` hole plus the `business` dictionaries. The
 * occupant is self-contained — a menu over a static catalog — so it declares
 * no inject face; its disclosure and selection ride the entry's declared
 * store, which outlives the shell unmounting the browsing region's wide
 * content at collapse.
 *
 * Hot-toggle: the settings section can enable/disable the sidebar group
 * without restarting. Toggling writes the home patch (persisted) and fires
 * a CustomEvent that the apply closure listens for to dispose or re-create
 * the sidebar.business slot registration immediately.
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

/* ------------------------------------------------------------------ */
/*  Settings section component                                        */
/* ------------------------------------------------------------------ */

const PLUGIN_ID = 'xmanrui-dsh-business-entry'

const settingsCss = {
  section: 'be_settings_section',
  heading: 'be_settings_heading',
  row: 'be_settings_row',
  label: 'be_settings_label',
  desc: 'be_settings_desc',
  switch: 'be_settings_switch',
  switchOn: 'be_settings_switch_on',
  knob: 'be_settings_knob',
  status: 'be_settings_status',
}

const settingsStylesheet = `
.${settingsCss.section}{display:flex;flex-direction:column;gap:16px;padding:8px 0}
.${settingsCss.heading}{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);margin:0 0 4px}
.${settingsCss.row}{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.${settingsCss.label}{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary,#1a1a1a)}
.${settingsCss.desc}{font-size:12px;color:var(--dsw-alias-label-tertiary,#999);margin-top:2px}
.${settingsCss.switch}{position:relative;width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;background:var(--dsw-alias-label-quaternary,#ccc);transition:background .2s;flex:none;padding:0}
.${settingsCss.switchOn}{background:var(--dsw-alias-state-business-primary,#6366f1)}
.${settingsCss.knob}{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.${settingsCss.switchOn} .${settingsCss.knob}{transform:translateX(18px)}
.${settingsCss.status}{font-size:12px;color:var(--dsw-alias-label-secondary,#666);margin-top:4px}
`

function BusinessEntrySettingsSection({ t }) {
  const [enabled, setEnabled] = React.useState(true)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const ipc = typeof window !== 'undefined' ? window.__DSH_IPC__ : undefined

  React.useEffect(() => {
    if (!ipc) { setLoading(false); return }
    ipc.invoke('dsh:plugin:isEnabled', PLUGIN_ID).then(val => {
      setEnabled(val)
      setLoading(false)
    }).catch(() => { setLoading(false) })
  }, [])

  const toggle = () => {
    if (!ipc || saving) return
    const next = !enabled
    setSaving(true)
    // Write home patch (persisted) then fire hot-toggle event (immediate).
    ipc.invoke('dsh:plugin:setEnabled', PLUGIN_ID, next).then(() => {
      setEnabled(next)
      setSaving(false)
      // Fire the custom event so the apply closure disposes/re-registers
      // the sidebar slot immediately — no restart needed.
      window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { enabled: next } }))
    }).catch(() => { setSaving(false) })
  }

  if (loading) {
    return React.createElement('div', { className: settingsCss.section },
      React.createElement('p', null, t('settings.loading')),
    )
  }

  return React.createElement('div', { className: settingsCss.section },
    React.createElement('h3', { className: settingsCss.heading }, t('settings.sectionLabel')),
    React.createElement('div', { className: settingsCss.row },
      React.createElement('div', null,
        React.createElement('div', { className: settingsCss.label }, t('settings.toggleLabel')),
        React.createElement('div', { className: settingsCss.desc }, t('settings.toggleDesc')),
      ),
      React.createElement('button', {
        type: 'button',
        className: clsx(settingsCss.switch, enabled && settingsCss.switchOn),
        onClick: toggle,
        disabled: saving,
        role: 'switch',
        'aria-checked': enabled,
        'aria-label': t('settings.toggleLabel'),
      },
        React.createElement('span', { className: settingsCss.knob }),
      ),
    ),
  )
}

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
      tag.textContent = stylesheet + settingsStylesheet
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

  // Listen for hot-toggle events from the settings section.
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

  // Register an independent settings section for business-entry configuration.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'business-entry',
      order: 50,
      label: () => ctx.locale.bind(NS)('settings.sectionLabel'),
      locale: NS,
    },
    BusinessEntrySettingsSection,
  ))
}
