# Agent Note: Desktop auto-injects the IM plugin

Status: implemented

[English](2026-11-19-desktop-auto-inject-im-plugin.md) | 中文

## 问题

Desktop 把 `@xmanrui/dsh-im`（微信 / 飞书 / …）打进安装包，并在 `pnpm dev` 下刷新进当前 web profile 的 `node_modules`，但 web profile 模板从不把它列入 `dsh.profile.bundles`。按 checkout 隔离的产品主目录一旦新建 web profile，IM 设置面就会消失，直到有人对该 profile 执行 `dsh plugin add`。`business-entry` 与 `dsh-skin` 已在包可解析时于启动注入各自的 cordis patch，从而避免这一问题。

## 决策

在 desktop Host 启动 overlays 中、business-entry 与 skin 注入之前，调用 `resolveOptionalBundlePatch(INSTALL_ANCHOR, '@xmanrui/dsh-im', …)`。已配置 `xmanrui-dsh-im` 的 profile 或 home patch（含 `disabled: true`）仍优先。

## 考虑过的替代方案

**让用户在每次新的产品主目录后重装插件。** 否决：Desktop 已经打包并复制该插件；对已随包装载的表面再要求手工 `dsh plugin add` 就是缺陷本身。

**把 `@xmanrui/dsh-im` 加进 web 的 `PROFILE_TEMPLATES` bundles 列表。** 否决：官方 web 模板也服务不在安装锚点提供该包的非 desktop Host。

## 后果

只要安装锚点能解析 `@xmanrui/dsh-im`，打包版与 `pnpm dev` 的 desktop 启动都会挂载「设置 → IM机器人」。已经安装或禁用该插件的 profile 保留其既有组合配置。
