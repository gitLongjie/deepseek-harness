# Agent Note: 常驻的业务入口设置分区与解耦的开关状态

Status: implemented

[English](2026-09-13-business-entry-resident-settings-tab.md) | 中文

## 问题

业务入口的可见性开关寄生在插件自己的客户端包里,而它的持久化状态是 home patch 层(`~/.dsh/cordis.patch.yml`)中的一行 `disabled: true`。补丁行是 Loader 指令:启动时 Loader 会整体跳过该插件,于是在上一个会话被禁用的插件,这次启动既不会运行拥有开关的客户端,也不会运行监听重新启用的客户端。此时把开关打开只是写了个文件,什么也挂载不了——用户看不到业务入口,除了手改补丁文件外无路可回。

## 决策

分区由壳层拥有。`ui-conversation` 注册一个常驻 `settings.section`(`business-entries`,仅桌面端——注册时探测 `window.__DSH_IPC__`),因此无论插件是否启用,tab 与开关都会渲染。开关状态移出补丁层,落入 `$DSH_HOME/plugin-settings.json`(`plugin-toggle.ts` 负责读写);插件本身始终挂载,仅以该状态决定 `sidebar.business` 注册与否,并监听 `dsh-business-entry:toggle` CustomEvent 实现热切换。插件移除自带的设置分区,home patch 层不再携带它的插件行。

## 已否决的替代方案

**依赖 config-only HMR 实现实时挂载。** 否决:桌面端没有保证生效的 config-only 重组,也无法同步刷新渲染端的客户端模块注册表,"重新启用"仍可能要求重启——一个说谎的开关。

**保留 loader 层禁用,并在文档中写明重新启用需重启。** 否决:持久化状态与挂载状态会在整个会话中互相矛盾,可见的开关与可见的侧边栏不一致。

## 后果

插件在每个会话都会挂载(host 入口为空,禁用时客户端不注册任何内容),用一次小的 bundle 加载换来一个永远诚实的开关。补丁层不再表达该插件的状态,因此手工为它在 `cordis.patch.yml` 写入 `disabled: true` 仍会在 Loader 层禁用插件,而常驻开关无法撤销——开关与该文件不再互相读写。纯 Web 部署看不到该分区(没有 preload 桥)。

## 验证

`apps/desktop/tests/plugin-toggle.spec.ts` 钉住 JSON 状态契约(回读、兄弟条目隔离、损坏文件恢复、home 目录创建)。`packages/client/ui-conversation/tests/business-section.client.spec.tsx` 覆盖仅桌面渲染、状态回读与两个切换方向(含热切换事件);`apply-wiring.client.spec.tsx` 钉住分区注册与 general-item 清单。
