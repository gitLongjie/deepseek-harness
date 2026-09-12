# @xmanrui/dsh-business-entry

English | [中文](README.zh.md)

The sidebar business-entry group plugin for DeepSeek Harness: it renders the deployment's own task entries (daily report, topics, briefings, and more) as one collapsible group below the workspace region.

## Install

The plugin is deployed to `~/.dsh/profiles/web/node_modules/@xmanrui/dsh-business-entry/` and registered in the profile's `package.json` bundles list.

## Build

```bash
cd business-entry
node build.mjs
```

After changing sources under `src/`, rebuild and restart the desktop app for the change to take effect.

## Toggle

Edit `~/.dsh/cordis.patch.yml` and uncomment the following lines to disable:

```yaml
- id: xmanrui-dsh-business-entry
  disabled: true
```

Delete or comment out the lines to re-enable.

## File layout

```
business-entry/
├── package.json          # package metadata + dsh.bundle/client declarations
├── cordis.patch.yml      # cordis composition-tree injection
├── build.mjs             # esbuild build script
├── src/
│   ├── client.jsx        # browser-side root component + plugin contract
│   ├── entries.js        # business-entry catalog (ids, labels, dot colors)
│   ├── locales.js        # English and Chinese dictionaries
│   ├── stores.js         # viewing-store factory
│   ├── styles.js         # CSS class names + stylesheet
│   └── index.js          # empty host-side entry
└── lib/                  # build output
    ├── client.js         # browser bundle
    └── index.js          # host entry
```
