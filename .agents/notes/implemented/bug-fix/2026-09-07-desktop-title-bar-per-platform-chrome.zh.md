# Agent Note：桌面标题栏按平台绘制样式，而不是在所有平台都套用 Windows 外观

Status: implemented

[English](2026-09-07-desktop-title-bar-per-platform-chrome.md) | 中文

## 问题

`createWindow` 在所有平台都用 `frame: false` 创建主窗口，渲染端标题栏（`apps/desktop/src/render/title-bar.ts`）也无条件绘制 Windows 外观：窗口内的“编辑/视图/窗口/帮助”菜单按钮，以及右侧带红色关闭填充的矩形“最小化/最大化/关闭”按钮组。于是打包出的 macOS 应用完全没有红绿灯（完全无边框窗口不携带任何原生控件），却显示着 Windows 控件；打包出的 Linux 应用同样是一身 Windows 相。渲染端没有任何机制知道自己正为哪个平台绘制。

## 决策

窗口工厂经 `apps/desktop/src/main/desktop/window-chrome.ts` 解析边框参数。包括 macOS 在内的每个平台都无边框，控件由渲染进程绘制，见[渲染进程绘制的标题栏](2026-11-07-renderer-drawn-desktop-title-bar.zh.md)。preload 桥把 `process.platform` 以 `platform` 暴露给渲染端，标题栏据此分支：macOS 在左侧绘制红绿灯，不绘制窗口内菜单——菜单归系统菜单栏；Windows 保留带红色关闭填充的矩形最小化/最大化/关闭按钮和窗口内菜单；Linux 保留窗口内菜单按钮（GNOME 没有全局菜单栏），但把 Windows 矩形按钮换成 Adwaita 风格的圆形中性悬停控件，去掉红色关闭填充。preload 平台字符串超出 Electron 已发布桌面平台时回退到 linux 外观。

## 已考虑的替代方案

**自绘 macOS 红绿灯，让一条代码路径服务所有平台。** 当初否决：原生红绿灯带有右键窗口菜单和按住 Option 点击关闭，用 Windows 控件替换它们正是本说明要修的缺陷。[渲染进程绘制的标题栏](2026-11-07-renderer-drawn-desktop-title-bar.zh.md)现在在页面里绘制 macOS 形状的红绿灯，因为系统标题栏会挡住弹窗。这些灯不是 Windows 矩形按钮。

**像 VS Code 那样把 Linux 当作 Windows 处理。** 否决：缺陷报告本身就要求平台之间必须不同；GNOME/libadwaita 的 header bar 使用圆形中性控件，Linux 上没有任何东西依赖红色关闭填充或通栏矩形按钮。

## 验证

`apps/desktop/tests/window-chrome.spec.ts` 锁定 darwin、win32、linux 和未知平台都是无边框。`apps/desktop/tests/title-bar.spec.ts` 覆盖三种渲染变体（macOS：红绿灯、无菜单；Windows：矩形外观、保留红色关闭；Linux：保留菜单、圆形控件、无红色填充）与平台回退。

## 后果

打包的 macOS 应用显示渲染进程绘制的红绿灯，且没有窗口内菜单；Linux 与 Windows 外观明显区分。窗口控件与菜单弹出的 IPC 通道在所有平台照常注册，macOS 的红绿灯会发送窗口控件通道。放弃的原生红绿灯行为记在[渲染进程绘制的标题栏](2026-11-07-renderer-drawn-desktop-title-bar.zh.md)。
