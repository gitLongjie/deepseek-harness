# Agent Note：桌面 dev 构建刷新所有 client 包的 emit

Status: implemented

[English](2026-09-13-desktop-dev-refreshes-every-client-package.md) | 中文

## 问题

`apps/desktop/scripts/dev.ts` 在 Client-face tsdown 步骤之前，只刷新一个硬编码四包列表（`ui-login`、`ui-conversation`、`ui-brand-official`、`ui-layout`）的 TypeScript emit。tsdown 从各 client 包的 `lib/types` emit 打包，而不是源码，因此列表之外的任何 client 包——`ui-expert` 以及之后的每个——都会带着上一次的 bundle 上机：改动到达了 web 源码，却永远到不了桌面应用，且任何地方都不报错。

## 决策

dev 脚本从 `scripts/dev-web.ts` 导入 `discoverPluginDirs` 与 `discoverLibraryDirs`，把两者展开进 `tsc -b` 参数，emit 刷新因此覆盖每个 client 插件与库包，复用 web devserver 路径已在运行的同一套发现逻辑。新增 client 包不再需要改桌面启动器。

## 考虑过的替代方案

**把 `ui-expert` 追加进硬编码列表。** 否决：只修复一例，且保证下一个包重演同一缺陷；完整发现已存在于 `scripts/dev-web.ts`，桌面构建复用它，删除第二份列表而不是再维护一份。

**让 tsdown 直接从源码打包。** 否决：为了修一个仅桌面端的过期缺陷，改动所有消费者的共享 Client-face 构建。

## 验证

`tests/dev-oem.spec.ts` 断言启动器把 `discoverPluginDirs(repoRoot)` 与 `discoverLibraryDirs(repoRoot)` 展开进 tsc 步骤，且排在 tsdown 打包步骤之前。

## 后果

桌面 dev 冷启动每次编译所有 client 包，emit 全量成本前置支付；正确输出不再依赖记得去扩列表。
