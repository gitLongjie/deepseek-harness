# Agent Note：桌面标题栏在 Windows 和 macOS 上都由渲染进程绘制

Status: implemented

[English](2026-11-07-renderer-drawn-desktop-title-bar.md) | 中文

## 问题

桌面窗口把页面自绘栏和系统标题栏叠在一起。Windows 与 Linux 已经无边框，但标题栏使用了最大 z-index，菜单、提示条和对话框顶部都被它盖住。macOS 用 `titleBarStyle: 'hiddenInset'` 保留原生红绿灯。这层标题栏合成在页面之上，弹窗只要伸到窗口顶部，页面里的 z-index 都盖不过它。

## 决策

`resolveWindowChrome` 在包括 macOS 在内的每个平台都返回 `{ frame: false }`。`apps/desktop/src/render/title-bar.ts` 在页面里绘制标题栏。Windows 保留窗口内菜单和带红色关闭填充的矩形最小化/最大化/关闭按钮。Linux 保留菜单和圆形控件。macOS 在左侧绘制关闭、最小化、缩放三颗灯，不绘制窗口内菜单；菜单留在系统菜单栏，绿灯经 `toggleWindowZoom` 切换全屏。在拖拽区双击会发送同一条缩放通道，起点落在按钮上的双击不发送。

标题栏 z-index 为 40，低于模态遮罩（1000）以及传送到页面顶层的菜单和提示条（1100），高于普通页面内容。它在 `html` 上发布 `--dsh-shell-top-inset`、`--dsh-frame-chrome-top` 和 `--dsh-frame-overlay-top`。`overlayTopMargin` 在框架设置了 `--dsh-frame-top-clearance` 时用该值，否则用标题栏内缩，使菜单避开这 36px。全屏时标题栏仍然隐藏，并同时设置 `html[data-fullscreen]`。除标题栏以外、直接挂在 body 上的浮层为 `-webkit-app-region: no-drag`，因此盖住标题栏的弹窗仍能收到点击。

## 已考虑的替代方案

**保留系统标题栏，只把弹窗往下推。** 否决：系统标题栏，包括 `hiddenInset` 红绿灯，不是页面内容。必须占据这条带子的弹窗会一直留在它下面。先前的拆分见[按平台标题栏](2026-09-07-desktop-title-bar-per-platform-chrome.zh.md)。

**只降低标题栏 z-index，macOS 红绿灯仍交给系统。** 否决：红绿灯合成在任何页面 z-index 之上，Windows 上的修法到不了 macOS。

**打开 `data-windows-titlebar` 或 `data-platform='darwin'`，让客户端现有的标题栏布局提供内缩。** 否决：那套 macOS 布局会在页面内部再为原生红绿灯留一条带子，叠在渲染进程标题栏之上。外壳直接发布内缩变量，不设置这些属性。

## 后果

macOS 不再有红绿灯的右键窗口菜单，也不再有按住 Option 点击关闭即退出。绿灯进入全屏，而不是系统的缩放。Windows 与 Linux 的控件外观不变。弹窗内容通过已发布的内缩避开标题栏，两者重叠时弹窗画在上面。客户端里为原生红绿灯留白的 `data-platform='darwin'` 规则仍在页面中，外壳不设置该属性，因此它们不生效。[全屏标题栏说明](2026-09-12-macos-title-bar-drag-only-and-fullscreen-aware.zh.md)里的全屏隐藏仍然有效，并且 macOS 的缩放控件现在会触发它。

## 验证

`apps/desktop/tests/window-chrome.spec.ts` 锁定 darwin、win32、linux 和未知平台都是无边框，并锁定全屏与最大化的差别。`apps/desktop/tests/title-bar.spec.ts` 覆盖 macOS 红绿灯、Windows 与 Linux 控件、内缩变量、z-index 40、双击缩放和全屏属性。`packages/client/ui-primitives/tests/overlay-top-margin.client.spec.ts` 覆盖标题栏内缩回退。
