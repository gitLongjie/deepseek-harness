# @xmanrui/dsh-business-entry

[English](README.md) | 中文

DeepSeek Harness 侧边栏的业务入口分组插件：将部署自有的任务条目（日报、选题、速览等）作为一个可折叠分组渲染在工作区区域下方。

## 安装

插件已部署到 `~/.dsh/profiles/web/node_modules/@xmanrui/dsh-business-entry/`，并在 profile 的 `package.json` bundles 列表中注册。

## 构建

```bash
cd business-entry
node build.mjs
```

修改 `src/` 下的源文件后重新构建，重启 desktop 即可生效。

## 开关

设置面板左侧导航里有常驻的「业务入口」分区（仅桌面端）：它写入 `~/.dsh/plugin-settings.json` 并热重载侧边栏分组，无需重启。分区由壳层拥有，插件被隐藏时也始终可见。

该状态文件只控制侧边栏注册——插件本身始终挂载，这正是开关能实时生效的原因。手工编辑这个 JSON 与使用开关效果相同。

## 文件结构

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
