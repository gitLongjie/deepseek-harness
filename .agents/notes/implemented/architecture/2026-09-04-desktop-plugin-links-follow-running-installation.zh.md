# Agent Note：桌面端插件链接跟随当前安装

状态：implemented

[English](2026-09-04-desktop-plugin-links-follow-running-installation.md) | 中文

## 问题

开放（源码）形态的桌面端启动通过两条与其他 dsh 安装共享的链接链解析插件包：仓库根目录 `node_modules/@deepseek-ai` 下的链接，以及 `$DSH_HOME/profiles/node_modules` 回退目录。一个已安装的旧版桌面端把共享回退目录改指向了它自带的打包副本，而该副本早于 `dsh-subagent` 中的 `registerContinuableSetup`；与此同时 `dsh-tool-subagent-report` 仍通过更早的一代链接解析到工作区。启动由此把过期的 `subagents` 服务与崭新的消费者挂在同一棵树里，Loader 以 `ctx.subagents.registerContinuableSetup is not a function` 失败。

两个缺陷造成了这种代际错位。`ensureRootPluginLinks` 只在链接不存在时创建、存在即跳过，因此每条链接持续跟随共享回退目录当时的内容——而该目录会被最后执行 heal 的那个 dsh 安装改写。`resolveModuleFallbackEntries` 还记录原始解析路径，于是经顶层链接找到的条目会被写回成该链接路径本身，heal 时形成自引用环。

## 决策

`resolveModuleFallbackEntries` 把开放形态的每个条目锚定到物理包目录（`realpathSync.native`，对 pkg 快照路径做了保护）， healed 链接因此指向具体的包，而不是骑在链接链上。打包可执行文件保留原始解析路径：其模块代理必须保留快照内的虚拟模块 URL。

桌面端的 `ensureRootPluginLinks` 现在从当前安装的闭包（`dsh-app-boot` 新导出的 `resolveInstallationModuleLinks`）推导链接，把根作用域目录下的每条链接直接指向解析出的包目录，并在目标不一致时改写而不是跳过。不在当前安装作用域内的名字保留共享目录镜像，profile 作用域的插件仍可解析。启动由此不会再把其他安装的插件代际混入自己的树，错位的机器在下一次启动时自愈。

## 已考虑的替代方案

**去掉仓库根目录链接，从 profile 目录解析插件包。** 否决：vendored Loader 的裸导入从 `vendor/loader` 向上回溯，而不是从 profile baseUrl 解析，没有根链接时开放形态下所有 dsh 自有插件都无法解析。

**保留镜像链接，只刷新过期的目标。** 否决：共享回退目录仍是跨安装的争夺点；直接目标才能让桌面端不再依赖"最后一次 heal 的是谁"。

## 后果

源码形态的桌面端每次启动都会改写自己的根链接，共享回退目录也会 heal 到当前安装的闭包，旧版已安装发行版无法再向源码启动提供插件代码。链接改写有界：目标是稳定的物理路径，一次 heal 之后的启动不再改写。`healProfilesModuleFallback` 的链接现在携带 realpath 后的目标，对既有安装而言磁盘上的链接文本会一次性变化。

## 验证

`packages/boot/app-boot/tests/profile.spec.ts` 固定了两类物理目标锚定：经链接的 bundle 依赖，以及经顶层链接在安装之外找到的依赖。`apps/desktop/tests/boot.spec.ts` 固定了闭包直连目标、过期链接改写，以及闭包外名字的共享目录镜像。桌面端启动路径已在真实目录树上演练：根目录 `dsh-subagent` 链接解析到工作区包，其构建产物携带 `registerContinuableSetup`。
