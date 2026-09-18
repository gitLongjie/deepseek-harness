---
description: "The scheduled-work management surface: the sidebar panel row, the task catalog with batch management, the editor dialog, and run records, for users and maintainers of the page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-schedule-work

[English](README.md) | 中文

## 概述

本包渲染"定时工作"管理界面：侧边栏的时钟图标行，点击后把中央栏切换为整页的定时任务目录与"运行记录"标签。任务目录列出每个任务的规则摘要、派生状态与下次触发时间；支持按状态筛选、搜索、刷新，以及批量暂停、恢复和删除。添加/编辑对话框覆盖名称、提示词、工作空间绑定、完全访问、调度规则与有效期。所有数据都经过宿主的 `scheduleWork` Remote 通道；页面自身不持有任何调度状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

桌面与 Web 名册默认连同宿主 `schedule-work` 行一起启用本插件，无需 overlay。侧边栏展开时该行显示时钟图标和本地化的"定时工作"标签；折叠成栏时只剩图标，标签作为悬停提示与无障碍名称。点击该行经布局服务（`ctx.layout.selectPanel`）导航，会话原样保留在其后——回到会话由外壳自己的导航完成。

两个标签共享一条工具栏：状态筛选与搜索作用于任务目录；刷新会同时重读两份列表。行内操作（编辑、暂停或恢复、删除）在非批量模式下悬停出现；批量模式以复选框和一条操作栏替代。编辑对话框在本地校验（名称与提示词非空、规则完整），表单未完整前禁用提交；提交被拒时在表单下方显示宿主诊断。

### 状态与摘要

任务的显示状态是派生的：启用且存在下次触发为"进行中"；停用为"已暂停"（优先于过期，暂停的任务不会显示成"已结束"）；启用但不会再触发的为"已结束"（一次性任务已消耗，或有效期已过）。规则摘要在浏览器端由持久规则格式化——`每天 09:00`、`每周 周一 08:30`、`每 5 分钟`——跟随查看语言；下次运行的绝对时间行使用浏览器的日期时间格式。运行行显示所属任务名、起止时间与投递结果；失败的运行携带宿主诊断。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

插件做两次自己不拥有声明、但依赖其存在的槽位注册，均通过 `ctx.slots.inject` 完成，激活顺序无关：一条 `sidebar.panellist` 列表项（id `schedule-work`，order 60，标签为 thunk），单元渲染闹钟图标；以及在同一个键下的 keyed `main` 项，渲染 `ScheduleWorkPage`。布局服务会对照活动 main 注册表校验面板选择，这一对注册就是全部契约。页面组件接收注入的 `scheduleWork` 面（对 `ctx.remote.scheduleWork` 的薄 RemoteResult 解包封装）、编辑器工作空间选择器用的全局 `useWorkspaces` 钩子，以及命名空间的 `t` 席位。本地状态只有呈现：标签页、筛选、搜索、选择、对话框状态和已加载列表。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器入口：词典、侧边栏面板行与 keyed 主页面注册 |
| [`src/client/ScheduleWorkPage.tsx`](src/client/ScheduleWorkPage.tsx) | 目录标签、工具栏、批量管理与运行记录列表 |
| [`src/client/TaskEditor.tsx`](src/client/TaskEditor.tsx) | 添加/编辑对话框及其规则编辑器 |
| [`src/client/task-format.ts`](src/client/task-format.ts) | 纯规则摘要、派生状态与时间格式化 |
| [`src/client/locales.ts`](src/client/locales.ts) | 中英文页面文案 |
| [`src/index.ts`](src/index.ts) | 空宿主 apply，保持浏览器特性可被 Loader 寻址 |
| — | 不发布运行时不变量伴生包：本页面不拥有可变的跨插件状态。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Schedule-work 包](../../schedule/schedule-work/README.zh.md) —— 本页面背后的持久任务、触发循环与运行记录。
- [侧边栏外壳](../ui-sidebar/README.zh.md) —— 本包行注册进的全局面板列表。
- [客户端包地图](../README.zh.md) —— 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

间接效应：本包编辑的是持久任务记录；投递它们的 schedule-work 运行时才拥有一切模型可见效应。

#### KV Cache 效应

无直接失效。创建、暂停或删除任务不会改变任何运行中会话的前缀或已记录状态；后续触发所创建的会话按自己的组合建立自己的前缀。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- **无实时更新** —— 页面在挂载、刷新与每次变更后读取；页面打开时其他地方触发的一次运行要等下次刷新才出现。
- **运行记录无操作** —— 记录是只读的；从运行行打开关联会话是后续工作。
- **批量范围** —— 批量操作只作用于当前选择；没有跨筛选的全选。
- **每月规则单日** —— 编辑器对每个任务只提供一个日期；线类型接受列表。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
