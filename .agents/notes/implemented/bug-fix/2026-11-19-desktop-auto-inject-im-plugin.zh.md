# Agent Note: Desktop mounts the shipped IM plugin

Status: implemented

[English](2026-11-19-desktop-auto-inject-im-plugin.md) | 中文

## 问题

Desktop 已随包装载 `@xmanrui/dsh-im`（微信 / 飞书 / …）并在 `pnpm dev` 下刷新，但按 checkout 隔离的产品主目录新建 web profile 后，「设置 → IM机器人」仍会消失，原因彼此独立：

1. web profile 模板从不把它列入 `dsh.profile.bundles`，Loader 不会挂载，直到有人执行 `dsh plugin add`。
2. 以往 `pnpm dev` 只把 `lib/*.js` 与清单拷进 profile farm。Host 入口把生产依赖（`qrcode`、各渠道 SDK 等）留作 external；Loader 从 profile baseUrl 解析裸包名时加载这份残缺副本就会失败。仅在启动时注入 cordis patch 无法挽救从未启动的 Host。

## 决策

- 在 desktop Host 启动 overlays 中调用 `resolveOptionalBundlePatch(INSTALL_ANCHOR, '@xmanrui/dsh-im', …)`，只要安装锚点能解析该包就挂载 cordis 行。已配置 `xmanrui-dsh-im` 的 profile 或 home patch（含 `disabled: true`）仍优先。
- `pnpm dev` 将 web profile farm 指到完整 checkout 包（junction/symlink）；打包时用 `npm ci --omit=dev` 在 staged `lib/` 旁物化生产 `node_modules`，两种布局下 Host external 都能解析。
- 停止自动注入与打包 `@xmanrui/dsh-business-entry`；工作区包仍保留供本地构建，但不再是 desktop 随带表面。

## 考虑过的替代方案

**让用户在每次新的产品主目录后重装插件。** 否决：Desktop 已经打包该插件；对已随包装载的表面再要求手工 `dsh plugin add` 就是缺陷本身。

**把 `@xmanrui/dsh-im` 加进 web 的 `PROFILE_TEMPLATES` bundles 列表。** 否决：官方 web 模板也服务不在安装锚点提供该包的非 desktop Host。

**继续只向 profile farm 拷贝 `lib/`，指望安装锚点解析。** 否决：vendored Loader 从 profile baseUrl 解析裸插件包名，真正加载的是 farm 副本。

## 后果

只要 `@xmanrui/dsh-im` 可解析且 Host 入口能导入生产依赖，打包版与 `pnpm dev` 的 desktop 启动都会挂载「设置 → IM机器人」。已经安装或禁用该插件的 profile 保留其既有组合配置。业务入口不再出现，除非某 profile 显式安装它。
