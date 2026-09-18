# Agent Note: 打包版的客户端扫描从安装主机解析裸包条目

Status: implemented

[English](2026-09-18-client-scan-resolves-from-installed-host.md) | 中文

## 问题

[运行时闭包修复](2026-09-18-packaged-desktop-runtime-dependency-closure.zh.md)之后,打包版在构建机上仍能启动完整插件名册,而在真实安装上渲染出一个永不消失的插件加载界面。smoke 的仓库外、隔离 `DSH_HOME` 副本终于在构建机上复现了它:同一个负载,在仓库内运行组合出全部 61 个条目,拷出后只组合出 1 个 application 条目(47,505 字符的 index 渲染)——运行位置决定了图。

`ClientModuleRegistry.resolveSource` 用一个写反的条件选择解析基址:`exactPackageSpecifier(loaderName) === undefined` 选中的是非包说明符(cordis 内建、相对与 file 路径),于是每一条 scoped 裸包行(`@deepseek-ai/...`)都从 `$DSH_HOME` 里 profile 树的基址解析。从那里向上的 Node 解析会落在 `$DSH_HOME/profiles/node_modules`——这个回退目录只有 dev 运行的治愈逻辑才会填充——因此从未从检出目录运行过的机器解析不到任何客户端包,渲染器以零插件启动,永远等待 `uiRenderer`。

## 决策

普通裸包名(scoped 或非 scoped,以 `exactPackageSpecifier` 为准)从 `dshBareModuleBaseUrl ?? <所属树基址>` 解析;非包说明符保持所属树。registry 把该 fact 加入自己的 `inject` 列表——boot 层总是提供它(open 运行时为 undefined),该声明只是把依赖写成显式契约,没有 pending fiber 风险。open 运行时该 fact 为 undefined,回退保持 dev 行为不变;旧代码走的那条 profile 树解析仍服务于需要它的说明符。

## 已考虑的替代方案

**在打包启动时治愈回退目录。** 否决:闭包修复已经否决了为打包运行创建 `$DSH_HOME/profiles/node_modules` 条目;治愈会让打包版的正确性重新绑定到一个可写的旁路目录——同一种机器依赖,晚一步出现。

**改用 Loader 的导入机制解析,而不是包元数据遍历。** 暂时否决:扫描需要的是每个包的 manifest 和 client 导出路径,不是模块记录;从导入结果反推会重复基址 fact 已经锚定的那次解析。

## 后果

打包版安装在任何位置组合出相同的客户端图——仓库内、带空格的安装路径、`DSH_HOME` 全新的机器都一样。构建机失去它的意外优势:仓库外 smoke 现在会拦下"只在构建机能启动"的负载。运行过早期安装包的机器,其状态留在 `%APPDATA%\<显示名>`;同一修复中的目录决策见 [ASCII userData id 笔记](2026-09-18-desktop-userdata-ascii-id.zh.md)。

## 验证

`packages/client/modules/tests/node-half.client.spec.ts` 固定了 scoped 裸包行的打包基址解析(fixture 的 resolver 拒绝 profile 基址,只有安装主机能解析)、`dshBareModuleBaseUrl` 注入契约、以及晚到条目的重扫。打包 smoke 的 `client-graph` 检查在坏负载上报告 1 个 application 条目,修复后报告完整名册(61 个条目,约 12.6MB 的 index 渲染)。
