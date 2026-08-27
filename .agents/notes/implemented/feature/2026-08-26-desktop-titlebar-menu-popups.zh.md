# Agent Note: Desktop title bar menu buttons popping native submenus

Status: implemented

[English](2026-08-26-desktop-titlebar-menu-popups.md) | 中文

## Problem

桌面外壳是无边框窗口，Windows 和 Linux 因此从不绘制原生菜单栏；`installApplicationMenu()` 安装的应用菜单只能通过快捷键触达。可见的窗口饰件只剩品牌标志和三个窗口控制按钮，新用户没有任何可发现的入口去使用重新加载、缩放、开发者工具、开机自启或关于。隐藏的菜单模板也早已偏离主平台上的可用范围：Window 项调用 macOS 专有的 dock API，帮助项指向本项目并不拥有的站点，File 菜单唯一的条目与窗口关闭功能重复。关闭窗口会隐藏到托盘，而托盘点击是唯一的恢复途径。

## Decision

应用菜单保留带稳定顶层 id 的原生模板——`edit`（标准编辑 role）、`view`（重新加载、开发者工具、缩放、全屏）、`window`（最小化、缩放、关闭，外加"显示主窗口"，恢复、显示并聚焦所有应用窗口）、`help`（GitHub 仓库、GitHub Discussions 反馈、关于），外加 darwin 的 `appMenu` role，以及承载"登录时启动"、开发者工具和"退出"的 App 菜单。每个条目都显式固定中文 `label`；role 保留加速键与平台行为，显示文案不再跟随系统语言。帮助菜单只链接本仓库实际拥有的页面。

标题栏只绘制品牌标记——不带任何标题文字：产品名归侧边栏，原生窗口标题固定为它（见[桌面窗口标题 Agent Note](2026-08-26-desktop-window-title-pinned.zh.md)）——并在标记与窗口控制按钮之间渲染 编辑/视图/窗口/帮助 按钮。点击时经窗口控制所用的同一个通用 preload 桥发送 `dsh:menu:popup`，载荷为 `{ id, x, y }`——顶层菜单 id 加上按钮在窗口坐标系中的位置。`registerMenuPopupIpc()` 校验 wire 载荷（id 对照封闭集合 `{ edit, view, window, help }`；坐标可选但必须成对有效，否则整个请求被丢弃），随后用 `Menu.getApplicationMenu()?.getMenuItemById(id)?.submenu?.popup({ window })` 把对应的原生子菜单锚定在该坐标处，目标窗口取自发送方，与既有的一切桌面 fire-and-forget 通道一致。无论弹出层是否打开，菜单快捷键始终全局注册。

## Alternatives considered

**在渲染进程内用 HTML 实现整套菜单系统。** 否决：这会重新实现 Electron 已拥有的键盘加速键、role 本地化和平台子菜单行为；弹出原子菜单免费获得这一切。

**选择性去边框（`titleBarStyle`、`autoHideMenuBar`）以露出原生菜单栏。** 否决：Windows 无边框窗口没有可露出的菜单栏，而这些替代方案都会牺牲这个外壳赖以存在的品牌化自定义栏。

**菜单保持仅快捷键可达。** 否决：缺口正是可发现性——不可见的菜单回答不了初次使用者的任何需求。

**标题栏放一个派发自定义 DOM 事件的设置齿轮。** 目前否决：GUI 通过 ui-settings-general 拥有的插槽系统触发器打开设置面板，page world 不存在编程式打开器——这个按钮只会是死饰件。等这样的扩展点出现再回来做。

## Verification

`apps/desktop/tests/menu.spec.ts` 固定了封闭 id 集合、对照 Electron 44 role 并集收集的合法 role 不变量（这类 bug 中写错的 role 会在运行期失败）、恢复隐藏窗口的点击、帮助链接白名单，以及弹出通道校验——未知 id、非对象载荷、半无效坐标对、未知发送方。`apps/desktop/tests/title-bar.spec.ts` 固定了仅 logo 的品牌区（标记旁无文本节点）、按钮顺序与 `aria-haspopup` 标签、弹出载荷形状、控制通道路由和 head 阶段挂载推迟。`tsc -p apps/desktop` 通过。

## Consequences

每个平台现在都显示可用的 编辑/视图/窗口/帮助 菜单，带原生加速键与固定的中文文案；被托盘隐藏的会话经由 窗口 → 显示主窗口 重获键盘可达的恢复路径。页面只能向自己的窗口弹菜单，保住了既有通道按发送方限定信任范围的模式。标题栏多出四个按钮且不再有文字；body padding 布局机制未动。File 菜单移除，其唯一条目仍可经 窗口 → 关闭窗口 与标题栏 ✕ 使用。菜单不再跟随英文系统语言——这是有意为之：产品文案就是中文。
