# @xmanrui/dsh-business-entry

English | [中文](README.zh.md)

The sidebar business-entry group plugin for DeepSeek Harness: it renders the deployment's own task entries (daily report, topics, briefings, and more) as one collapsible group below the workspace region. A row is not a bookmark — clicking it runs that task in a new Agent session.

## Task launch

Each row is a standing task with one conversation:

1. Clicking a row opens the Session that entry already owns — the most recently updated non-archived Session titled with the entry's label, which is the title this plugin writes when it starts the task. Going back to a task therefore returns to its work, its artifacts, and its history.
2. The first click for an entry has no such Session yet: it resolves the target workspace — the open Session's workspace, else the most recently active one — and opens its New Session (created or reused, the same navigation as the sidebar's New Session control). With no workspace registered, it creates the Session directly.
3. That Session receives the entry's instruction (`prompt.<id>` in `src/locales.js`, next to the row label and equally locale-owned) as its first user message, and is titled with the entry's label — which is what makes step 1 find it again.

Ctrl/⌘/Alt+click asks for a fresh run instead. It starts a new Session and never deletes, replaces, or renames the earlier one: every previous run stays in the workspace's session list under that entry's label, with its full conversation.

Every row also discloses its own runs: the count on the row opens the entry's past conversations, newest first, with the running one flagged and the one the workspace currently shows marked. Selecting any of them opens it, and the list's first item starts a fresh run — the same thing Ctrl/⌘/Alt+click does from the row. Nothing is ever deleted by a launch, so a previous run stays both in that list and in the workspace's session list.

Every instruction opens by asking for the inputs it needs — data source, monitoring target, source material — because the click supplies nothing else. Rows stay disabled while a launch is in flight; a refused launch reports its own reason under the list, and clicking the notice dismisses it.

## Install

The plugin is deployed to `~/.dsh/profiles/web/node_modules/@xmanrui/dsh-business-entry/` and registered in the profile's `package.json` bundles list.

## Build

```bash
cd business-entry
node build.mjs
```

After changing sources under `src/`, rebuild and restart the desktop app for the change to take effect.

## Test

```bash
cd business-entry
node build.mjs && node --test tests/launch.test.mjs
```

`tests/launch.test.mjs` drives the built bundle through a fake module table and slot registry: it clicks a row and asserts the instruction that was sent, the session title, the no-workspace fallback, and the failure the group reports.

## Toggle

The settings panel carries a resident 业务入口 section in its nav (desktop only): it writes `~/.dsh/plugin-settings.json` and hot-reloads the sidebar group without a restart. The section is shell-owned, so it stays visible even while the plugin is hidden.

The state file only gates the sidebar registration — the plugin itself always mounts, which is what keeps the toggle working live. Hand-editing that JSON has the same effect as using the switch.

## File layout

```
business-entry/
├── package.json          # package metadata + dsh.bundle/client declarations
├── cordis.patch.yml      # cordis composition-tree injection
├── build.mjs             # esbuild build script
├── src/
│   ├── client.jsx        # browser-side root component + plugin contract
│   ├── entries.js        # business-entry catalog (ids, labels, prompt keys, dots)
│   ├── locales.js        # English and Chinese dictionaries, incl. every instruction
│   ├── stores.js         # viewing-store factory (disclosure, selection, launch status)
│   ├── styles.js         # CSS class names + stylesheet
│   └── index.js          # empty host-side entry
├── tests/
│   └── launch.test.mjs   # click-to-launch behavior over the built bundle
└── lib/                  # build output
    ├── client.js         # browser bundle
    └── index.js          # host entry
```
