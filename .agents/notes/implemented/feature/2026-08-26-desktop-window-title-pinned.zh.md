# Agent Note: Desktop window title pinned to the bare product name

Status: implemented

[English](2026-08-26-desktop-window-title-pinned.md) | 中文

## Problem

桌面外壳从未设置原生窗口标题，因此 Electron 会顺次采用加载页面携带的内容：先是 dist
index 的 `<title>`（深度Works Local Build），再是所选会话标题的每次投影
（来自 DocumentTitle 的 `<session title> — <product title>`）。在 Windows
上这些字符串会被外壳直接暴露：悬停任务栏按钮会把窗口标题作为提示显示，alt-tab
也会列出它们——用户期望看到的只是产品名，却只读到构建后缀和逐会话的文本。

## Decision

`createWindow()` 以 `title: DESKTOP_WINDOW_TITLE`（深度Works）构造 BrowserWindow，
并由 `pinWindowTitle()` 阻止每一次 `page-title-updated` 事件，由此原生标题在窗
口整个生命周期内始终保持为纯粹的产品名。托盘提示携带相同的字符串。渲染进程仍
然完全拥有 `document.title`——浏览器标签页继续显示会话标题——但该值不再传到任何
原生外壳表面。

## Alternatives considered

**改成改渲染端（DSH_CLIENT_TITLE / 去掉会话后缀）。** 否决：这是为修复桌面外壳表
面而牺牲浏览器 GUI 的标题行为；主进程已经拥有原生窗口所有权，在此处阻止继承便
不会触碰其他消费者。

**继续采纳 document.title，再以定时器 / 焦点事件复位。** 否决：Electron 提供了
专为此种选择而设计的事件，围绕它做竞态式的簿记毫无意义。

## Verification

`apps/desktop/tests/window-title.spec.ts` 固定了 DESKTOP_WINDOW_TITLE 为 深度Works
并断言每次发出的 page-title-updated 都会被 preventDefault。
`pnpm --filter @deepseek-ai/dsh-desktop run test` 通过。

## Consequences

无论打开哪个会话，Windows 任务栏悬停提示与 alt-tab 仅显示 深度Works；放弃那里
的“一眼看到当前会话”能力是被接受的——侧边栏与 Web 应用仍投影会话标题。未来的多窗
口场景下每个窗口沿用同一个固定标题。