# @xmanrui/dsh-business-entry

[English](README.md) | 中文

DeepSeek Harness 侧边栏的业务入口分组插件：把部署自有的任务条目（日报、选题、速览等）作为一个可折叠分组渲染在工作区区域下方。每一行都不是书签——点击即在新的 Agent 会话里跑这个任务。

## 任务启动

每一行都是一个「有固定会话的常驻任务」：

1. 点击一行会打开该入口已经拥有的会话——标签标题下、未归档、最近更新的那个 Session；这个标题正是插件启动任务时写入的。因此回到某个任务，就是回到它的对话、产物和历史。
2. 某个入口的第一次点击还没有这个会话：它解析目标工作区——优先当前打开会话所属的工作区，其次最近活跃的工作区——并打开它的 New Session（新建或复用，与侧边栏 New Session 控件走同一条导航）。若尚未注册任何工作区，则直接创建会话。
3. 该会话把条目的指令（`src/locales.js` 里的 `prompt.<id>`，与行标签相邻、同样由语言包拥有）作为第一条用户消息收下，并以条目标签命名——第 1 步正是靠它再找回来。

Ctrl/⌘/Alt+点击 = 这一次要新开一个。它会新建会话，绝不删除、替换或改名旧的那个：此前每一次运行都留在所属工作区的会话列表里，标题就是该条目标签，完整对话都在。

每一行还会列出它自己的历次运行：行上的数字展开该入口过去的会话，按时间倒序，进行中的会标注，当前工作区正打开的那个会高亮。点其中任意一条即打开它；列表第一项是「新开一个会话」——与在行上 Ctrl/⌘/Alt+点击等价。启动永远不会删除任何东西，所以此前那次运行既留在这个列表里，也留在所属工作区的会话列表里。

每条指令都以「先向我确认所需输入」开场——数据来源、监测对象、素材——因为一次点击本身不提供任何输入。启动期间所有行都禁用；启动被拒时在列表下方给出原因，点击该提示即可关闭。

## 安装

插件已部署到 `~/.dsh/profiles/web/node_modules/@xmanrui/dsh-business-entry/`，并在 profile 的 `package.json` bundles 列表中注册。

## 构建

```bash
cd business-entry
node build.mjs
```

修改 `src/` 下的源文件后重新构建，重启 desktop 即可生效。

## 测试

```bash
cd business-entry
node build.mjs && node --test tests/launch.test.mjs
```

`tests/launch.test.mjs` 用仿造的模块表与插槽注册表驱动构建产物：点击一行并断言发出的指令、会话标题、无工作区时的回退路径，以及分组报告出来的失败。

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
