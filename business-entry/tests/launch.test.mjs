/**
 * Launch-behavior spec for the built browser bundle.
 *
 * The plugin renders through the real slot machinery in the app, so this spec
 * drives the bundle the app loads: it evaluates `lib/client.js` against a fake
 * `window.__ModuleLoader__`, registers the occupant into a fake slot registry,
 * and clicks a row through the component tree that `apply` produced. What is
 * asserted is the user-visible contract of a click — a Session opened in the
 * target Workspace, the entry's instruction sent as its first prompt, the
 * Session titled after the entry — plus the failure the group must report
 * when the prompt is refused.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BUSINESS_ENTRIES } from '../src/entries.js'
import { zh } from '../src/locales.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * React stand-in: the occupant only builds elements, so createElement's
 * `{ type, props }` product is all this spec reads back.
 */
const react = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  }),
  Fragment: Symbol('Fragment'),
}

/** Store engine stand-in with the production action-baking semantics. */
function fakeDefineStore(spec) {
  return {
    spec,
    create() {
      const state = spec.init()
      const actions = {}
      for (const [name, action] of Object.entries(spec.actions)) {
        actions[name] = (...args) => { action(state, ...args) }
      }
      return { actions, getSnapshot: () => state, subscribe: () => () => {}, clearPersisted: () => {} }
    },
  }
}

/** Bare observable stand-in with the production snapshot-store contract. */
function fakeSnapshotStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    set: (next) => { state = next; for (const listener of [...listeners]) listener() },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

/**
 * The module table the bundle resolves against: React (element construction)
 * and the client store engine, both externalized by the build.
 * @param specifier - the bare module request.
 * @returns the module the app would hand this bundle.
 */
function moduleTable(specifier) {
  return specifier === '@deepseek-ai/dsh-client-store'
    ? { defineStore: fakeDefineStore, createSnapshotStore: fakeSnapshotStore }
    : react
}

/**
 * Evaluate the built bundle and hand back everything a click needs.
 * @returns the bundle's exports plus the listeners it registered.
 */
function loadBundle() {
  const source = readFileSync(resolve(here, '..', 'lib', 'client.js'), 'utf8')
  const listeners = new Map()
  const window = {
    addEventListener: (type, listener) => { listeners.set(type, listener) },
    removeEventListener: (type) => { listeners.delete(type) },
  }
  let moduleExports
  window.__ModuleLoader__ = {
    load: ({ factory }) => { moduleExports = factory(moduleTable) },
  }
  const run = new Function('window', 'document', source)
  run(window, undefined)
  assert.ok(moduleExports?.apply, 'the bundle must export apply')
  return { exports: moduleExports, listeners }
}

/** Collect the one `sidebar.business` registration a booted bundle makes. */
function withPlugin(options = {}) {
  const calls = []
  const session = {
    prompt: async (content, mode) => {
      calls.push(['prompt', content, mode])
      return options.promptResult ?? { ok: true, value: { accepted: true } }
    },
    rename: async (title) => {
      calls.push(['rename', title])
      return { ok: true, value: { title, seq: 1 } }
    },
  }
  const workspaceSnapshot = {
    phase: 'ready',
    items: options.workspaces ?? [{ workspaceId: 'ws-1', sessionIds: ['sess-old'], createdAt: '2026-01-01T00:00:00Z' }],
    archivedSessionIds: options.archived ?? [],
  }
  const workspaceListeners = new Set()
  const workspaces = {
    list: {
      getSnapshot: () => workspaceSnapshot,
      subscribe: (listener) => { workspaceListeners.add(listener); return () => { workspaceListeners.delete(listener) } },
    },
  }
  // Mutable list: a test seeds the Session a previous task created to exercise
  // the resume and history paths, exactly as the Session Controller publishes them.
  const sessionList = {
    phase: 'ready',
    current: undefined,
    ids: Object.keys(options.sessions ?? { 'sess-old': { updatedAt: 1 } }),
    byId: { ...(options.sessions ?? { 'sess-old': { updatedAt: 1 } }) },
  }
  const sessionListeners = new Set()
  let created = 0
  const sessions = {
    list: {
      getSnapshot: () => sessionList,
      subscribe: (listener) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
    },
    binding: () => ({ session }),
    scope: () => undefined,
    sessionOf: () => undefined,
    create: async () => {
      created += 1
      const sessionId = `sess-${String(created)}`
      calls.push(['create', sessionId])
      return sessionId
    },
  }
  const uiWorkspace = {
    openWorkspace: async (workspaceId, beforeOpen) => {
      calls.push(['openWorkspace', workspaceId])
      if (beforeOpen !== undefined) beforeOpen(`sess-${String(created + 1)}`)
    },
    openSession: (id) => { calls.push(['openSession', id]) },
    startSession: () => { calls.push(['startSession']) },
  }
  let registration
  const ctx = {
    effect: (factory) => factory(),
    locale: {
      register: () => () => {},
      bind: () => (key) => zh[key],
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (spec, component) => {
        registration = { spec, component }
        return () => {}
      },
    },
    workspaces,
    sessions,
    uiWorkspace,
  }
  const { exports } = loadBundle()
  exports.apply(ctx)
  assert.ok(registration, 'apply must register the sidebar.business occupant')
  const instance = registration.spec.store.create()
  const injected = registration.spec.inject(instance.actions)
  /** Publish one titled Session as a task run would leave it. */
  const seedSession = (sessionId, title, updatedAt = 2, running = false) => {
    sessionList.ids = [...sessionList.ids, sessionId]
    sessionList.byId = { ...sessionList.byId, [sessionId]: { updatedAt, title, running } }
  }
  /** Fire both list subscriptions, as a real publication change would. */
  const publish = () => {
    for (const listener of [...sessionListeners]) listener()
    for (const listener of [...workspaceListeners]) listener()
  }
  return { calls, instance, seedSession, publish, sessionList, ...registration, injected }
}

/** The props one render of the occupant receives. */
function propsOf(plugin, event) {
  const t = (key, params) => (params === undefined
    ? zh[key]
    : zh[key].replace(/\{(\w+)\}/gu, (_, name) => String(params[name])))
  return {
    wide: true,
    expandSidebar: () => {},
    useStore: (selector) => selector(plugin.instance.getSnapshot()),
    useHistory: (selector) => selector(plugin.injected.hooks.history.getSnapshot()),
    actions: plugin.instance.actions,
    t,
    launch: plugin.injected.launch,
    openSession: plugin.injected.openSession,
    ...(event === undefined ? {} : { event }),
  }
}

/** Render the occupant and click one row's button. */
function click(plugin, id, event) {
  const tree = plugin.component(propsOf(plugin))
  const label = zh[BUSINESS_ENTRIES.find(entry => entry.id === id).label]
  const button = findButton(tree, label)
  button.props.onClick(event)
  return button
}

/** Depth-first search for the row button whose text ends with the entry label. */
/** Depth-first search for the row button carrying one label. */
function findButton(node, label) {
  return collect(node, candidate => candidate.type === 'button'
    && flatten(candidate.props.children).includes(label))[0]
}

/** Every node in the element tree matching one predicate, in render order. */
function collect(node, matches) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => collect(child, matches))
  const found = matches(node) ? [node] : []
  return [...found, ...collect(node.props?.children, matches)]
}

/** Every rendered button belonging to one CSS class (the shaped stand-in lacks a DOM). */
function buttonsOfClass(tree, className) {
  return collect(tree, node => node.type === 'button'
    && String(node.props.className ?? '').split(' ').includes(className))
}

/** Join an element tree's text children into one string. */
function flatten(children) {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(flatten).join('')
  if (children !== null && typeof children === 'object') return flatten(children.props?.children)
  return ''
}

/** Let the launched promise chain settle. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0) })

test('a click opens the target Workspace Session and sends the entry instruction', async () => {
  const plugin = withPlugin()
  assert.equal(plugin.instance.getSnapshot().pending, undefined)
  click(plugin, 'dailyReport')
  // The store reports the row as launching while the prompt is in flight.
  assert.equal(plugin.instance.getSnapshot().pending, 'dailyReport')
  await settle()
  assert.deepEqual(plugin.calls.map(call => call[0]), ['openWorkspace', 'prompt', 'rename'])
  assert.equal(plugin.calls[0][1], 'ws-1')
  const promptEntry = BUSINESS_ENTRIES.find(entry => entry.id === 'dailyReport')
  assert.deepEqual(plugin.calls[1][1], [{ type: 'text', text: zh[promptEntry.prompt] }])
  assert.equal(plugin.calls[1][2], 'queue')
  assert.equal(plugin.calls[2][1], zh[promptEntry.label])
  assert.deepEqual(plugin.instance.getSnapshot(), {
    expanded: true,
    selected: 'dailyReport',
    pending: undefined,
    error: undefined,
    historyFor: undefined,
  })
})

test('a refused prompt reports its own reason on the group', async () => {
  const plugin = withPlugin({ promptResult: { ok: false, error: { code: 'session/busy', message: 'session is running' } } })
  click(plugin, 'topics')
  await settle()
  assert.equal(plugin.instance.getSnapshot().error, 'session/busy: session is running')
  assert.equal(plugin.instance.getSnapshot().pending, undefined)
  // The rename never runs behind a refused prompt.
  assert.deepEqual(plugin.calls.map(call => call[0]), ['openWorkspace', 'prompt'])
})

test('a second click goes back to the Session that task already produced', async () => {
  const plugin = withPlugin()
  click(plugin, 'dailyReport')
  await settle()
  // The task Session now exists under the entry label, as the rename left it.
  plugin.seedSession('sess-1', zh['item.dailyReport'], 5)
  plugin.calls.length = 0
  click(plugin, 'dailyReport')
  await settle()
  // Reopening is the whole effect: no second Session, no second instruction.
  assert.deepEqual(plugin.calls.map(call => call[0]), ['openSession'])
  assert.equal(plugin.calls[0][1], 'sess-1')
  assert.equal(plugin.instance.getSnapshot().pending, undefined)
  assert.equal(plugin.instance.getSnapshot().error, undefined)
})

test('the newest Session titled with the entry wins when several exist', async () => {
  const plugin = withPlugin()
  plugin.seedSession('sess-older', zh['item.topics'], 10)
  plugin.seedSession('sess-newer', zh['item.topics'], 99)
  plugin.calls.length = 0
  click(plugin, 'topics')
  await settle()
  assert.deepEqual(plugin.calls.map(call => call[0]), ['openSession'])
  assert.equal(plugin.calls[0][1], 'sess-newer')
})

test('an archived task Session is not reopened — the click starts a new run', async () => {
  const plugin = withPlugin({ archived: ['sess-1'] })
  plugin.seedSession('sess-1', zh['item.report'], 5)
  plugin.calls.length = 0
  click(plugin, 'report')
  await settle()
  assert.deepEqual(plugin.calls.map(call => call[0]), ['openWorkspace', 'prompt', 'rename'])
})

test('a modifier click starts a fresh run and leaves the old Session alone', async () => {
  const plugin = withPlugin()
  plugin.seedSession('sess-1', zh['item.videoScript'], 5)
  plugin.calls.length = 0
  click(plugin, 'videoScript', { ctrlKey: true })
  await settle()
  // A new Session is created and prompted; nothing touches the owned one.
  assert.deepEqual(plugin.calls.map(call => call[0]), ['openWorkspace', 'prompt', 'rename'])
  assert.equal(plugin.sessionList.ids.filter(id => id === 'sess-1').length, 1)
})

test('past runs publish newest first, with the running one flagged', async () => {
  const plugin = withPlugin()
  plugin.seedSession('sess-older', zh['item.dailyReport'], 10)
  plugin.seedSession('sess-newer', zh['item.dailyReport'], 99, true)
  plugin.seedSession('unrelated', '随便一个会话', 50)
  plugin.publish()
  const history = plugin.injected.hooks.history.getSnapshot()
  assert.deepEqual(history.entries.dailyReport.map(row => row.sessionId), ['sess-newer', 'sess-older'])
  assert.equal(history.entries.dailyReport[0].running, true)
  // Another entry's runs stay out of this entry's list, and a session that is
  // not titled with any entry label is not a task run at all.
  assert.deepEqual(history.entries.topics, [])
})

test('an entry with past runs discloses them, and a run opens from the list', async () => {
  const plugin = withPlugin()
  const older = Date.parse('2026-10-16T09:12:00')
  const newer = Date.parse('2026-10-16T10:38:00')
  plugin.seedSession('sess-older', zh['item.sentiment'], older)
  plugin.seedSession('sess-newer', zh['item.sentiment'], newer)
  plugin.sessionList.current = 'sess-older'
  plugin.publish()
  // Nothing is disclosed until the row asks for it.
  assert.equal(buttonsOfClass(plugin.component(propsOf(plugin)), 'be_historyItem').length, 0)
  const toggle = buttonsOfClass(plugin.component(propsOf(plugin)), 'be_historyToggle')[0]
  assert.equal(toggle.props['aria-label'], zh['item.history'].replace('{count}', '2'))
  toggle.props.onClick()
  assert.equal(plugin.instance.getSnapshot().historyFor, 'sentiment')
  const items = buttonsOfClass(plugin.component(propsOf(plugin)), 'be_historyItem')
  // New-run affordance first, then this entry's runs newest first.
  assert.equal(flatten(items[0].props.children), zh['history.new'])
  const stamps = items.slice(1).map(item => flatten(item.props.children))
  assert.deepEqual(stamps, ['10-16 10:38', '10-16 09:12'])
  plugin.calls.length = 0
  items[1].props.onClick()
  assert.deepEqual(plugin.calls, [['openSession', 'sess-newer']])
  // The run the workspace currently shows is marked as such.
  const marked = buttonsOfClass(plugin.component(propsOf(plugin)), 'be_historyItemCurrent')
  assert.deepEqual(marked.map(item => flatten(item.props.children)), ['10-16 09:12'])
  assert.deepEqual(marked.map(item => item.props['aria-current']), ['true'])
})

test('the disclosed list starts a fresh run from its own affordance', async () => {
  const plugin = withPlugin()
  plugin.seedSession('sess-1', zh['item.multiFormat'], 5)
  plugin.publish()
  plugin.instance.actions.toggleHistory('multiFormat')
  const items = buttonsOfClass(plugin.component(propsOf(plugin)), 'be_historyItem')
  items[0].props.onClick()
  await settle()
  assert.deepEqual(plugin.calls.map(call => call[0]), ['openWorkspace', 'prompt', 'rename'])
})

test('a deployment with no Workspace still runs the task in a new Session', async () => {
  const plugin = withPlugin({ workspaces: [] })
  click(plugin, 'rumor')
  await settle()
  assert.deepEqual(plugin.calls.map(call => call[0]), ['create', 'openSession', 'prompt', 'rename'])
  assert.equal(plugin.calls[1][1], 'sess-1')
  assert.deepEqual(plugin.calls[2][1], [{ type: 'text', text: zh['prompt.rumor'] }])
})

test('the failure notice clears on the next launch', async () => {
  const plugin = withPlugin({ promptResult: { ok: false, error: { code: 'session/busy', message: 'busy' } } })
  click(plugin, 'report')
  await settle()
  assert.equal(plugin.instance.getSnapshot().error, 'session/busy: busy')
  plugin.instance.actions.beginLaunch('report')
  assert.equal(plugin.instance.getSnapshot().error, undefined)
  plugin.instance.actions.failLaunch('kept')
  plugin.instance.actions.clearError()
  assert.equal(plugin.instance.getSnapshot().error, undefined)
})

test('every catalog entry carries a label and instruction in both dictionaries', async () => {
  const { en } = await import('../src/locales.js')
  for (const entry of BUSINESS_ENTRIES) {
    for (const key of [entry.label, entry.prompt]) {
      assert.equal(typeof zh[key], 'string', `zh is missing ${key}`)
      assert.equal(typeof en[key], 'string', `en is missing ${key}`)
    }
  }
})
