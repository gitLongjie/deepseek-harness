# Agent Note：桌面标题栏按平台绘制样式，而不是在所有平台都套用 Windows 外观

Status: implemented

[English](2026-09-07-desktop-title-bar-per-platform-chrome.md) | 中文

## 问题

`createWindow` 在所有平台都用 `frame: false` 创建主窗口，渲染端标题栏（`apps/desktop/src/render/title-bar.ts`）也无条件绘制 Windows 外观：窗口内的“编辑/视图/窗口/帮助”菜单按钮，以及右侧带红色关闭填充的矩形“最小化/最大化/关闭”按钮组。于是打包出的 macOS 应用完全没有红绿灯（完全无边框窗口不携带任何原生控件），却显示着 Windows 控件；打包出的 Linux 应用同样是一身 Windows 相。渲染端没有任何机制知道自己正为哪个平台绘制。

## 决策

窗口工厂改经 `apps/desktop/src/main/desktop/window-chrome.ts` 按平台解析边框参数：macOS 以 `titleBarStyle: 'hiddenInset'` 加 `trafficLightPosition`（把 12px 红绿灯居中于 36px 自绘栏）创建窗口，原生红绿灯因此保留在自绘栏之上；Windows 与 Linux 维持完全无边框。preload 桥把 `process.platform` 以 `platform` 暴露给渲染端，标题栏据此分支：macOS 只绘制品牌图标、拖拽区域与红绿灯让位区（80px 内边距）之后的更新槽——菜单归系统菜单栏，最小化/最大化/关闭归原生红绿灯；Windows 保持现有外观不变；Linux 保留窗口内菜单按钮（GNOME 没有全局菜单栏），但把 Windows 矩形按钮换成 Adwaita 风格的圆形中性悬停控件，去掉红色关闭填充。preload 平台字符串超出 Electron 已发布桌面平台时回退到 linux 外观——唯一完全由渲染端绘制的变体。

## 已考虑的替代方案

**自绘 macOS 红绿灯，让一条代码路径服务所有平台。** 否决：原生红绿灯携带重绘无法保留的平台行为（右键窗口菜单、按住 Option 点关闭即退出）以及 HIG 摆放位置；用 Windows 控件替换它们正是本次要修的缺陷。

**像 VS Code 那样把 Linux 当作 Windows 处理。** 否决：缺陷报告本身就要求平台之间必须不同；GNOME/libadwaita 的 header bar 使用圆形中性控件，Linux 上没有任何东西依赖红色关闭填充或通栏矩形按钮。

## 验证

`apps/desktop/tests/window-chrome.spec.ts` 锁定各平台的窗口参数，以及“钉住的红绿灯居中于渲染端 `TITLE_BAR_HEIGHT_PX`”这一不变量；`apps/desktop/tests/title-bar.spec.ts` 覆盖三种渲染变体（macOS：无菜单、无控件、红绿灯让位；Windows：外观不变、保留红色关闭；Linux：保留菜单、圆形控件、无红色填充）与平台回退。`pnpm --filter @deepseek-ai/dsh-desktop run test` 与 `run typecheck` 通过。

## 后果

打包的 macOS 应用显示原生红绿灯且不再有窗口内菜单；Linux 与 Windows 外观明显区分。窗口控件与菜单弹出的 IPC 通道在所有平台照常注册，但 macOS 端不会再发送它们。栏高如今在主进程侧为红绿灯几何再次声明，因包内 tsc 程序只编译 `src/main` 与 `src/preload`，只能靠居中测试（而非共享导入）与渲染端常量绑定。
