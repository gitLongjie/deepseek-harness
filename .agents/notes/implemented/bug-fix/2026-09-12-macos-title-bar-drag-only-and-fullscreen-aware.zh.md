# Agent Note：macOS 标题栏跟随原生全屏

Status: implemented

[English](2026-09-12-macos-title-bar-drag-only-and-fullscreen-aware.md) | 中文

## 问题

2026-09-07 的按平台标题栏拆分仍留下两处不符合 macOS 惯例的地方。darwin 分支继续绘制品牌图标，而 macOS 标题栏只应承载红绿灯加拖拽区，不含 logo。标题栏也没有处理全屏：macOS 进入全屏时会隐藏所有窗口修饰，但固定定位的标题栏仍盖在内容上，body 的 36px 顶部位移让应用持续被压在一条空带下方。

## 决策

`apps/desktop/src/render/title-bar.ts` 在平台为 darwin 时不绘制品牌图标。红绿灯画在页面里，不再留成一条空的内缩；这套外观记在[渲染进程绘制的标题栏](2026-11-07-renderer-drawn-desktop-title-bar.zh.md)。`apps/desktop/src/main/index.ts` 的 createWindow 通过 `dsh:window:fullscreen-change` 转发 `enter-full-screen`/`leave-full-screen`，渲染端切换 `body[data-dsh-fullscreen]` 和 `html[data-fullscreen]`。这些规则隐藏标题栏、清零 body 顶部内边距和已发布的顶部内缩，使固定定位的客户端浮层在全屏期间填满窗口。macOS 的缩放灯调用 `setFullScreen`，因此走的就是这条路径。

## 已考虑的替代方案

**用 CSS `:fullscreen` 伪类在样式层检测全屏。** 否决：Electron 的原生窗口全屏不会设置 DOM fullscreen 伪类，选择器永远匹配不到它要描述的状态。

**由渲染端单一启发式在所有平台隐藏标题栏。** 否决：今天没有任何路径让 Windows/Linux 进入窗口全屏，该分支是无失败案例支撑的死代码；频道本身与平台无关，这些平台发出同样的推送即可复用。

## 验证

`apps/desktop/tests/title-bar.spec.ts` 断言 darwin 安装渲染红绿灯且没有菜单按钮，全屏载荷切换 `data-dsh-fullscreen` 和 `data-fullscreen`，且注入的样式文本包含隐藏与清零规则。

## 后果

macOS 标题栏绘制红绿灯、拖拽区和更新位，不解析品牌图标。全屏推送在所有平台接线。macOS 的缩放控件调用 `setFullScreen`，Windows 或 Linux 上的 `win.setFullScreen` 调用方会得到同样的标题栏隐藏。
