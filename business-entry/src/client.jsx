/**
 * Business-entry plugin, browser half: one registration into the sidebar
 * shell's `sidebar.business` hole plus the `business` dictionaries. The
 * occupant is a menu over the deployment's task catalog, so it declares no
 * inject face of its own beyond the launch callback; its disclosure,
 * selection, and launch status ride the entry's declared store, which
 * outlives the shell unmounting the browsing region's wide content at
 * collapse.
 *
 * Clicking a row OPENS that task: the Session the entry already owns — found by
 * the entry label it was titled with — or, when it owns none yet, the target
 * Workspace's New Session (created or reused, the same navigation the sidebar's
 * New Session control takes) with the row's instruction sent as that session's
 * first prompt. So a row goes back to the conversation that task produced, and
 * only the first click starts one. Each instruction opens by asking for the
 * inputs it needs, because nothing has been supplied at click time.
 *
 * A modifier click (Ctrl/⌘/Alt) asks for a fresh run instead. That never
 * replaces or deletes the previous task Session: it stays in the workspace's
 * session list under the entry label.
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

function BusinessNav({ wide, expandSidebar, useStore, useHistory, actions, launch, openSession, t }) {
  const expanded = useStore(s => s.expanded)
  const selected = useStore(s => s.selected)
  const pending = useStore(s => s.pending)
  const error = useStore(s => s.error)
  const historyFor = useStore(s => s.historyFor)
  const history = useHistory(s => s)

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
      BUSINESS_ENTRIES.map(entry => {
        const busy = pending === entry.id
        const past = history.entries[entry.id] ?? []
        const open = historyFor === entry.id
        return React.createElement('li', { key: entry.id },
          React.createElement('div', { className: css.row },
            React.createElement('button', {
              type: 'button',
              className: clsx(css.item, selected === entry.id && css.itemActive, busy && css.itemBusy),
              'aria-current': selected === entry.id ? 'true' : undefined,
              'aria-busy': busy ? 'true' : undefined,
              title: t('item.hint'),
              // One task at a time: a second click while the first is still
              // opening its Session would race the same blank placeholder.
              disabled: pending !== undefined,
              // A modifier click is the explicit "run this again" — the plain
              // click returns to the task Session this entry already owns.
              onClick: (event) => {
                actions.select(entry.id)
                launch(entry.id, { fresh: event?.ctrlKey === true || event?.metaKey === true || event?.altKey === true })
              },
            },
              busy
                ? React.createElement('span', { className: css.spinner, 'aria-hidden': 'true' })
                : React.createElement('span', {
                  className: css.dot,
                  style: { background: entry.dot },
                }),
              t(entry.label),
            ),
            // Every run this entry ever started, one click away. The row itself
            // opens the newest; this disclosure is how the earlier ones stay
            // reachable instead of scrolling out of the workspace's list.
            past.length > 0 && React.createElement('button', {
              type: 'button',
              className: css.historyToggle,
              'aria-expanded': open,
              'aria-label': t('item.history', { count: past.length }),
              title: t('item.history', { count: past.length }),
              onClick: () => { actions.toggleHistory(entry.id) },
            }, React.createElement(IconChevronDown, {
              size: 12,
              className: clsx(css.chevron, !open && css.chevronCollapsed),
            })),
          ),
          open && React.createElement('ul', { className: css.history },
            React.createElement('li', null,
              React.createElement('button', {
                type: 'button',
                className: clsx(css.historyItem, css.historyNew),
                onClick: () => { launch(entry.id, { fresh: true }) },
              }, t('history.new')),
            ),
            past.map(row => React.createElement('li', { key: row.sessionId },
              React.createElement('button', {
                type: 'button',
                className: clsx(css.historyItem, row.sessionId === history.current && css.historyItemCurrent),
                'aria-current': row.sessionId === history.current ? 'true' : undefined,
                onClick: () => { openSession(row.sessionId) },
              },
                React.createElement('span', { className: css.historyTime }, formatSessionTime(row.updatedAt)),
                row.running
                  ? React.createElement('span', { className: css.historyRunning }, t('history.running'))
                  : null,
              ),
            )),
          ),
        )
      }),
    ),
    // The launch outcome is the only thing this group can fail at, and the
    // row that failed is already highlighted — so the reason belongs here,
    // under the list, dismissed by clicking it.
    expanded && error !== undefined && React.createElement('div', {
      className: css.note,
      role: 'alert',
      title: t('launch.dismiss'),
      onClick: () => { actions.clearError() },
    },
      React.createElement('span', { className: css.noteText }, t('launch.failed')),
      React.createElement('span', { className: css.noteDetail }, error),
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
/*  Task launch                                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve the workspace a business task opens in: the workspace of the open
 * session, else the most recently active one — the same target policy the
 * sidebar's New Session control applies.
 * @param ctx - the plugin context (workspaces and sessions services).
 * @returns the target WorkspaceId, or undefined while the lists are not ready
 * or no workspace is registered.
 */
function targetWorkspaceId(ctx) {
  const workspaces = ctx.workspaces.list.getSnapshot()
  const sessions = ctx.sessions.list.getSnapshot()
  if (workspaces.phase !== 'ready' || sessions.phase !== 'ready') return undefined
  if (sessions.current !== undefined) {
    const owner = workspaces.items.find(item => item.sessionIds.includes(sessions.current))
    if (owner !== undefined) return owner.workspaceId
  }
  let best
  let bestTime = Number.NEGATIVE_INFINITY
  for (const item of workspaces.items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of item.sessionIds) {
      const session = sessions.byId[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(item.createdAt)
    if (best === undefined || latest > bestTime) { best = item; bestTime = latest }
  }
  return best === undefined ? undefined : best.workspaceId
}

/**
 * Resolve the business Session behind one id — the binding first, then the
 * scoped context, because a Session the controller has only just created is
 * addressable through whichever of the two it has materialized so far.
 * @param ctx - the plugin context.
 * @param sessionId - the target Session.
 * @returns the Session face, or undefined while neither path resolves it.
 */
function sessionFaceOf(ctx, sessionId) {
  const bound = ctx.sessions.binding(sessionId)
  if (bound !== undefined) return bound.session
  const actx = ctx.sessions.scope(sessionId)
  return actx === undefined ? undefined : ctx.sessions.sessionOf(actx)
}

/**
 * Every label an entry can be titled with, in either dictionary. A task
 * Session keeps whatever label was current when it started, so matching the
 * other dictionary too keeps a task reachable after the UI language changes.
 */
const ENTRY_TITLES = new Map(BUSINESS_ENTRIES.flatMap(entry => [
  [zh[entry.label], entry.id],
  [en[entry.label], entry.id],
]))

/**
 * List the task Sessions one entry owns, newest first: the non-archived
 * Sessions titled with the entry's label.
 *
 * The title IS the entry's durable mark — {@link deliverPrompt} writes it when
 * it starts the task — so the association survives a reload, a restart, and a
 * window that never saw the launch. It is also what makes every earlier run
 * listable, and why a plain click resumes rather than starting a parallel task.
 * @param ctx - the plugin context (workspace archive set and session list).
 * @param entryId - the catalog entry whose Sessions to collect.
 * @returns the entry's Sessions, newest first.
 */
function taskSessionsOf(ctx, entryId) {
  const sessions = ctx.sessions.list.getSnapshot()
  const archived = ctx.workspaces.list.getSnapshot().archivedSessionIds
  const found = []
  for (const sessionId of sessions.ids) {
    if (archived.includes(sessionId)) continue
    const summary = sessions.byId[sessionId]
    if (summary === undefined) continue
    const title = summary.title?.trim()
    if (title === undefined || ENTRY_TITLES.get(title) !== entryId) continue
    found.push({ sessionId, updatedAt: summary.updatedAt, running: summary.running === true })
  }
  found.sort((left, right) => right.updatedAt - left.updatedAt)
  return found
}

/**
 * Derive the published task history: which Session is open, and each entry's
 * own runs newest first.
 * @param ctx - the plugin context.
 * @returns the history snapshot.
 */
function deriveTaskHistory(ctx) {
  const entries = {}
  for (const entry of BUSINESS_ENTRIES) entries[entry.id] = taskSessionsOf(ctx, entry.id)
  return { current: ctx.sessions.list.getSnapshot().current, entries }
}

/**
 * Render one Session's last activity as a compact, locale-neutral stamp. The
 * list orders runs, so what a row needs is when it was, not a translated date.
 * @param updatedAt - epoch milliseconds of the Session's last activity.
 * @returns `MM-DD HH:mm`.
 */
function formatSessionTime(updatedAt) {
  const at = new Date(updatedAt)
  const pad = value => String(value).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Send one entry's instruction as the first prompt of a Session, then name
 * that Session after the entry so the list says which task produced it — and
 * so {@link taskSessionsOf} finds it again.
 *
 * The title rename is best-effort: an explicit title pins the Session against
 * automatic regeneration, but a refused rename must not turn a delivered
 * prompt into a reported failure.
 * @param ctx - the plugin context.
 * @param sessionId - the Session receiving the prompt.
 * @param promptText - the localized instruction, sent verbatim as one text block.
 * @param title - the entry label to title the Session with.
 */
async function deliverPrompt(ctx, sessionId, promptText, title) {
  const session = sessionFaceOf(ctx, sessionId)
  if (session === undefined) throw new Error(`session ${sessionId} is not addressable`)
  const result = await session.prompt([{ type: 'text', text: promptText }], 'queue')
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  await session.rename(title).then(() => undefined, () => undefined)
}

/**
 * Run one business task: open the target Workspace's New Session (created or
 * reused) and deliver the entry's instruction into it. The beforeOpen hook
 * runs once the Session is synchronously addressable, which is when its
 * prompt can be accepted; the delivery promise is awaited afterwards so a
 * failed prompt reaches the row instead of scrolling by unnoticed.
 * @param ctx - the plugin context (workspace navigation and session services).
 * @param promptText - the localized instruction to send.
 * @param title - the entry label to title the Session with.
 * @returns the Session the task runs in.
 */
async function startEntryTask(ctx, promptText, title) {
  const workspaceId = targetWorkspaceId(ctx)
  if (workspaceId !== undefined) {
    let started
    let sessionId
    await ctx.uiWorkspace.openWorkspace(workspaceId, (adopted) => {
      sessionId = adopted
      started = deliverPrompt(ctx, adopted, promptText, title)
    })
    // Absent only when a later navigation superseded this one before it opened.
    if (started !== undefined) await started
    return sessionId
  }
  // No Workspace to attach to: create the Session directly and open it.
  const sessionId = await ctx.sessions.create({})
  ctx.uiWorkspace.openSession(sessionId)
  await deliverPrompt(ctx, sessionId, promptText, title)
  return sessionId
}

/**
 * Turn a rejected launch into the one line the group shows. Wire and business
 * failures already carry their own words; anything else is stringified rather
 * than swallowed.
 * @param reason - the rejection value.
 * @returns the message text.
 */
function describeReason(reason) {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Open one entry: the task Session it already owns, or a new one when it has
 * none yet.
 *
 * Going back to the owned Session is the default because a business entry is a
 * standing task, not a one-shot command — the conversation, its produced
 * artifacts and its history are what the row is for. A fresh run is an
 * explicit choice (modifier-click), which never deletes or replaces the
 * previous Session: the earlier conversation stays in the workspace's session
 * list under its own title.
 * @param ctx - the plugin context.
 * @param id - the entry id the row reported.
 * @param actions - the declared store's baked write set.
 * @param options - `fresh` forces a new task Session for this click.
 */
async function launchEntry(ctx, id, actions, options) {
  const entry = BUSINESS_ENTRIES.find(candidate => candidate.id === id)
  if (entry === undefined) return
  const t = ctx.locale.bind('business')
  actions.beginLaunch(id)
  try {
    const owned = options?.fresh === true ? undefined : taskSessionsOf(ctx, id)[0]
    if (owned !== undefined) {
      ctx.uiWorkspace.openSession(owned.sessionId)
      actions.endLaunch()
      return
    }
    await startEntryTask(ctx, t(entry.prompt), t(entry.label))
    actions.endLaunch()
  } catch (reason) {
    actions.failLaunch(describeReason(reason))
  }
}

/* ------------------------------------------------------------------ */
/*  Plugin contract                                                   */
/* ------------------------------------------------------------------ */

const NS = 'business'

export const inject = ['slots', 'locale', 'workspaces', 'sessions', 'uiWorkspace']

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

  // --- Published task history ---
  // Which Session is open plus every entry's own runs, derived from the two
  // authoritative lists and republished on every change to either. One source
  // for the whole group: the rows' disclosures and the resume target read the
  // same snapshot, so they cannot disagree about which run is the latest.
  const taskHistory = clientStore.createSnapshotStore(deriveTaskHistory(ctx))
  ctx.effect(() => {
    const publish = () => { taskHistory.set(deriveTaskHistory(ctx)) }
    const offSessions = ctx.sessions.list.subscribe(publish)
    const offWorkspaces = ctx.workspaces.list.subscribe(publish)
    publish()
    return () => {
      offSessions()
      offWorkspaces()
    }
  }, 'dsh-business-entry: task history')

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
        // The launcher closes over the registration's own store actions, so a
        // refused launch reports on the row that asked for it. `history` is the
        // registrant-private reactive fact: it reaches the component as the
        // bound `useHistory` selector hook, never as a source.
        inject: (actions) => ({
          launch: (id, options) => { void launchEntry(ctx, id, actions, options) },
          openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
          hooks: { history: taskHistory },
        }),
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
