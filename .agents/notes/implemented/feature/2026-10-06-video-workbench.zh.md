# Agent Note: 视频 workbench 首落地（oh-story-dsh 模式）

Status: implemented

[English](2026-10-06-video-workbench.md) | 中文

## Problem

社区 [oh-story-dsh](https://github.com/zenstory-ai/oh-story-dsh) 把四个创作工作台（小说/短剧/游戏/视频解说）打进 DSH Web 的方式证明了三条原则：文件即创作事实（工作台只投影项目文件，不写并行数据库）、付费操作先确认、宿主只加只读路由而浏览器加面板。我们的 H3 视频管线（`h3-video` + `tool-video`）已经把计划、关键帧、分镜与成片落进一个输出目录，但桌面上没有浏览它们的表面——用户只能去文件系统里翻 `~/.dsh/cache/video`。

直接照搬 oh-story 的客户端不可行也不必要：它作为外部插件只能用 `shell.overlay` + DOM 锚点 `createPortal` 的取巧挂载，且它自带整套短剧文档协议（`用途`/`控制` 槽位），我们的 plan schema 没有这些作者概念。

## Decision

按 oh-story 的投影原则、用我们仓库的正规扩展点落一个视频工作台 v1：

- **宿主半边**（`dsh-experimental-video-workbench`，web-app bundle 的 HOST 行）：两条只读路由。`GET /api/video-workbench/projects` 扫 `plans/*.json` 报告逐镜头落盘状态（multi_shot 折叠到合成 `all` 段，损坏计划降级为一条错误行）；`GET /api/video-workbench/file?path=` 服务单个白名单文件。`outputDir` 缺省即 `dshCachePath('video')`——与 h3-video 服务缺省同目录，标准部署零配置。
- **包含性**：请求路径先拆纯名字段（拒绝 `..`、盘符、`<>:"|?*` 与 NUL），逐段 `join` 到投影根下，`realpath` 双端解析后 `relative` 复查——目录内符号链接指向外部也被拒。扩展白名单（文本/图片/视频/音频），单文件 256 MB。
- **浏览器半边**（`dsh-client-ui-video-workbench`，patch 的 client 行）：走布局的全局面板机制而不是 DOM portal——`sidebar.panellist` 一行（id `video-workbench`，ui-schedule-work 同款模式）+ keyed `main` 页面。左列项目目录，右侧关键帧缩略图 + 逐镜头状态 + 成片 `<video>`；打开时/每 10 秒/按钮刷新；文案走 `videoWorkbench` 字典命名空间。
- **无写路径**：工作台对模型循环不可见（不挂工具、不发会话事件），浏览器拿到的唯一能力是读。渲染仍由 `tool-video` 的 `/video` 流程驱动。

## Alternatives considered

- **移植 oh-story 的整套客户端（overlay + portal）。** 拒绝：仓库内插件有正规槽位机制；querySelector 锚点是我们不能接受的脆弱面。
- **给 ui-sidebar/ui-conversation 加新洞。** 拒绝：`sidebar.panellist` + `main` keyed 槽已覆盖"侧栏入口 + 全局面板"的布局，加洞是无谓的契约扩张。
- **经 Remote（ctx.remote.*）而非 HTTP 路由供数。** 拒绝：媒体（mp4）走 JSON Remote 需要整段 base64；同源 HTTP 流式响应天然支持 `<video>`/`<img>`，也是 oh-story 的做法。
- **v1 就做编辑/重渲染按钮。** 不做：付费操作先确认是 oh-story 的红线；写路径属于 tool-video 流程（已有确认门），工作台先做纯读投影。

## Consequences

- 用户在 Web/桌面侧栏多一个"视频工作台"面板，成片与关键帧即点即看；输出目录里的东西不需要进会话历史。
- 新增两个包与 patch 两行；`tsconfig.base.json` paths 加映射（verify-cordis-config 的 source-plane 要求），web-app 与 desktop 的依赖清单各加两行。
- 两个 typecheck 聚合各收录自己那一半：`tsconfig.host.json` 引用宿主半，`tsconfig.client.json` 引用浏览器半。新包若缺席所属聚合就哪里都编译不到：`tsc -b` 会在该包自身的相对导入上报 TS6307，`tsdown` 不会运行，宿主半也就不产出 `lib/index.js`——Loader 行随即导入失败，而由包内 tsdown 配置构建的客户端 bundle 看起来一切正常。因此缺聚合条目这件事，直到面板没出现才会被发现。
- listing 轮询每 10 秒一次只读扫描，输出目录巨大时的成本由 FILE 级 readdir/stat 构成，未做分页（项目数以 plans/*.json 计）；需要时在路由加 `?since=`。
- 后续工作台（按 oh-story 的小说/短剧模式）可复用这套"宿主只读路由 + panellist/main 面板"骨架；角色/skill 层（oh-story 的 role-tool、skill provider）留待对应工作台需要时再落。
- 文件服务的 v1 无 Range 支持（浏览器整段缓冲后可 seek；Mimosa 写入门禁对 range 头解析误报命令注入，砍掉该面换取落地，后续可在门禁规则修正后补回）。

## References

- oh-story-dsh 工作台模式参考：其 `packages/dsh-plugin/src/client/index.tsx`（槽位声明 + 投影）、`src/workspace-route.ts`（只读路由 + 白名单）、`src/client/workbench-presence.ts`（项目检测）
- 本仓库实现：`packages/experimental/video-workbench/src/{index,projects,file-serve}.ts`、`packages/client/ui-video-workbench/src/client/{index,VideoWorkbenchPage,endpoints,locales}.ts`
- 组合：`packages/bundle/web-app/cordis.patch.yml`（HOST 行 `video-workbench` + client 行 `ui-video-workbench`）
- 关联 note：`2026-10-06-h3-video-oh-story-alignment.md`（同日落的管线对齐）
