# Agent Note: 桌面 dev 裸插件名解析与 dev 更新检查

Status: implemented

[English](2026-11-03-desktop-dev-external-plugin-resolution.md) | 中文

## 问题

品牌化 dev 可执行文件启动的是 web profile，但裸插件名从 `apps/desktop` 向上解析到仓库根 `node_modules`。`ensureRootPluginLinks` 只镜像 `@deepseek-ai` scope，web profile farm 携带的第三方插件包（`dsh-wechat`、`dsh-zentao-report`、`@xmanrui/*`、`@tt-a1i/*`）只能依赖 9 月手工建的符号链接——没有链接的包（`dsh-wechat`、`dsh-zentao-report`）每次启动都导入失败。同一次启动还会跑更新器：品牌化 exe 与安装版一样报告 `app.isPackaged`，于是 `initUpdater` 接上 OEM feed 并请求 `alpha.yml`——feed 从未发布过该元数据文件，每次启动一次 404，每个静默复查节拍再来一次。

## 决策

`ensureRootPluginLinks` 现在同时把 web profile farm `node_modules` 中每个清单声明 `dsh.bundle` 的包镜像到仓库根对应位置（含 scoped 包名）；无 `dsh.bundle` 的 farm 库与 `@deepseek-ai` scope（由既有 `profilesAi` 镜像负责）不参与。dev 启动器导出 `DSH_DESKTOP_DEV=1`，`initUpdater` 视其为未接线 feed：不 `setFeedURL`、不绑事件、不启动检查、不复查，`updateChecksEnabled` 报告 false，帮助菜单项与渲染器徽标保持惰性。从不设置该标志的安装版行为不变。

## 备选方案

**通过 `bareModuleBaseUrl` 从 farm 解析插件名。** 否决：vendored Loader 的普通裸导入从 `vendor/loader` 解析而非挂载基址；仓库根镜像才是 dev 可执行文件已经依赖的机制。

**把 generic feed 钉在 `latest` 通道以免请求 `alpha.yml`。** 否决：这会让拥有独立版本线的 OEM 构建收到上游 stable 发布提示；开发态不检查是更好的消音方式，feed 侧应发布通道元数据或把 OEM `updateUrl` 指向自己的 feed。

**按 farm 清单重装 farm。** 否决：farm 的 `@xmanrui/*` 包早于其清单存在，pnpm 重建会把它们剪掉。

## 验证

`apps/desktop/tests/boot.spec.ts` 覆盖第三方镜像（合格包落在 scoped 与非 scoped 位置、非插件库与 `@deepseek-ai` scope 被排除、二次执行幂等）；既有用例现在钉住 `profilesModules`，测试不再触碰真实 farm。

## 后果

损坏的 farm 安装仍会以插件导入失败浮出，但缺件只要在某处存在就会被链接上，只有真正缺失的包才会失败。开发态启动完全不再触碰更新 feed。
