# Agent Note: 桌面安装包内置 business-entry 侧边栏插件

Status: implemented

[English](2026-09-12-desktop-ships-business-entry-plugin.md) | 中文

## 问题

`sidebar.business` 席位随客户端 bundle 发布了，但它的占位方——`@xmanrui/dsh-business-entry` 插件——只通过 `dev.ts` 到达开发者机器：把本地构建的副本拷进那台机器的 `~/.dsh` profile。于是每个安装包渲染的侧边栏都静默缺少业务入口分组，而且打包路径上没有任何信号能区分"部署本身没有业务条目"和"接线忘了暂存插件"。

## 决策

安装包完全按照 dsh-im 的方式暂存该插件。`business-entry` 加入 pnpm workspace（其 esbuild devDependency 随根锁文件安装；多余的 npm `package-lock.json` 已删除），`deploy-app.mjs` 通过 workspace 安装构建它，并把 `lib/`、`package.json`、`cordis.patch.yml` 暂存到 `dist/business-entry-package`，builder 配置再把暂存包拷入 `app.asar/node_modules/@xmanrui/dsh-business-entry`。启动时 `resolveOptionalBundlePatch` 从安装锚点探测该包，只要能解析且声明了 `dsh.bundle.patch`，就把它的补丁列表作为启动 overlay 注入——用户无须改 profile 清单。包不存在是可选情形，返回 `undefined`；包存在但解析失败则像其他补丁层一样让启动响亮失败。

## 考虑过的替代方案

**继续把插件部署到用户家目录 profile。** 否决：家目录 profile 是每台机器的用户状态；全新安装后侧边栏分组会消失，只有手工拷贝才回来——这正是本次要闭合的缺口。

**把插件折进某个 workspace 客户端包。** 否决：部署方拥有自己的条目目录并独立重建；workspace 成员身份会把它的发布节奏与 harness 绑死，而独立包的纪律（自有构建、自有清单）正是它不随 harness 发版就能变更的前提。

## 验证

`apps/desktop/tests/boot.spec.ts` 在临时锚点上驱动 `resolveOptionalBundlePatch`：已安装且声明补丁的包加载其 insert 行；未安装返回 `undefined`；已安装但未声明补丁层返回 `undefined`；补丁层损坏则抛错。打包冒烟启动真实产物，暂存的插件要么挂载、要么让门禁失败。

## 后果

从 v1.2.1 起安装包内置业务入口分组，家目录副本退化为仅开发期关注点。探测通过 `createRequire` 读取应用锚点，源码布局与 app.asar 布局行为一致。未来第二个可选包复用同一个辅助函数，business-entry 调用点保持一行注入。将来若要从安装包移除插件，删掉暂存与装箱两处即可，启动探测退化为 `undefined`，组合树无须改动。
