# Agent Note：market-local 在打包宿主中通过 config 解析安装锚点

Status: implemented

[English](2026-09-06-market-local-install-anchor-config.md) | 中文

## 问题

打包后的桌面壳无法启动：`market-local` 加载项在插件构造期抛出 `cannot resolve the running dsh installation (@deepseek-ai/dsh)`，整个 web profile 的挂载随之失败。该插件此前从自身模块位置出发，按 Node 搜索路径探测 CLI 应用包名来定位安装锚点。这一探测在工作区检出（CLI 包在搜索路径上）和 `dsh` CLI 安装中有效，但在桌面 asar 内永远失败：壳的应用包是以 `@deepseek-ai/dsh-desktop` 为名、位于 asar 根的包，而 CLI 包根本没有随包发布。打包冒烟门在发布前拦下了这个问题。

## 决策

`LocalMarket.Config` 新增可选的 `installAnchor` 路径，构造期校验其存在性，缺省时回退到原有探测。桌面 boot 通过 `resolveMarketAnchorPatch` boot 补丁交出自己的锚点——与下发预设根用的是同一套 overlay 机制——仅当组合确实挂载该行时生效，并对行的 config 做展开合并，因为补丁的 config 是整体替换。各宿主保持显式：CLI 继续走探测，桌面壳传入它已经交给 `loadProfile` 与 `healProfilesModuleFallback` 的同一个锚点。

## 已考虑的替代方案

**给探测扩展更多候选包名。** 否决：壳的应用包位于 asar 根而非 `node_modules` 包，任何按包名的探测都找不到它；扩充名单只会扩大一个本就失效的查找。

**`DSH_INSTALL_ANCHOR` 环境变量。** 否决：埋在构造函数里的隐式配置，违背显式配置规则；Config 字段在插件配置处即可校验并有文档。

## 验证

`packages/market/market-local/tests/index.spec.ts` 覆盖配置锚点优先于探测（精确路径透传到 `pnpmUninstall`），以及锚点不存在时的响亮报错。`apps/desktop/tests/boot.spec.ts` 覆盖 `resolveMarketAnchorPatch` 仅在行存在时返回锚点补丁。桌面打包冒烟（`pnpm --filter @deepseek-ai/dsh-desktop run smoke -- --skip-build`）验证带 market 挂载项的打包壳可以启动。

## 后果

打包桌面壳带着 market 插件正常启动；安装、卸载与已装列表以壳自身的清单为锚点——正是其根插件链接跟随的同一份清单。指向不存在文件的 `installAnchor` 配置现在在加载期即失败，而不是等到第一次市场操作。
