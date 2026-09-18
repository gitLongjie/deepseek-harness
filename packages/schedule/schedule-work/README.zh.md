---
description: "App-level scheduled work: durable tasks on calendar or fixed-rate rules dispatched into Sessions with run records, for users and maintainers choosing, configuring, or debugging the package."
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule-work

[English](README.md) | 中文

## 概述

Schedule-work 是桌面端"定时工作"页面背后的宿主能力：应用级定时任务按计划运行一条提示词，每次触发都会在绑定的工作空间里打开一个新会话。规则覆盖一次性时刻、每天/每周/每月的本地日历时间以及固定间隔；任务可以暂停、可以设置有效期截止，还可以把新会话切换到 danger-full-access 权限预设。每次触发都会写入关联会话的持久运行记录。状态存放在 `schedule_work` 存储域，宿主侧通过 Typert Remote 的 `scheduleWork` 命名空间访问。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [触发语义](#dispatch-semantics)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

桌面与 Web 图谱默认一起挂载 `schedule-work` 宿主行和 `ui-schedule-work` 浏览器行，无需 overlay。浏览器侧即管理页面——创建、编辑、暂停、恢复、批量删除任务并浏览运行记录。本包没有 Config schema：启停由组合决定，所有随部署变化的值（规则、提示词、工作空间绑定）都是逐任务的数据。

Remote 命名空间 `scheduleWork` 暴露 `list`、`listRuns`、`create`、`update`、`remove`。校验拒绝以 `schedule-work/invalid-task` Remote 失败返回并携带出错字段；编辑命名不存在的任务以 `schedule-work/task-not-found` 返回。

### 规则

规则是下列之一：

- `once` —— 一个 RFC 3339 时刻。
- `daily` —— 每天同一个本地 `HH:mm` 时刻。
- `weekly` —— 列出的星期几（0 = 周日至 6 = 周六）在同一个本地时刻。
- `monthly` —— 列出的月内日期在同一个本地时刻；没有该日期的月份不产生触发（不做钳制）。
- `interval` —— 至少 300 秒的固定频率，锚定在任务的创建时刻。

日历规则按宿主本地时区解析：桌面程序就运行在用户所在时区。夏令时空档按 `Date` 构造产生的偏移时刻触发；重叠取第一个时刻。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

网关是一个 `TypertRemoteService`，其 Service init 打开 `schedule_work` 域并启动运行时的排水定时器（30 秒）。`ScheduleWorkRuntime` 读取 `tasks` 与 `runs` 两张表，其余全部推导：任务的下次触发由规则、`lastRunAt`（否则 `createdAt`）与有效期计算得出——从不持久化，因此不会与规则偏离。每次排水扫描已启用任务在 `(lastRunAt, now]`（按 `validUntil` 收口）窗口内的触发点；窗口内最晚的一个胜出，因此暂停多日的任务只补跑一次、落在最晚错过的槽位，下一轮等待从那里开始（latest-only 补跑，与会话提醒调度器一致）。

一次触发的顺序：写入 `running` 运行记录，经域写链把 `lastRunAt` 原子地移到该触发点，通过会话控制器创建会话（设定了工作空间则附挂上去），按需经命令运行时执行 `/permission danger-full-access`，把提示词作为会话的首条用户消息入队，然后等 Agent 回到空闲才把记录定稿为 `succeeded`。任何一步抛错都以 `failed` 定稿并携带诊断；完全访问开关无法执行（permission-presets 插件缺失）时触发按失败收场，而不是用默认权限悄悄继续。同一任务的触发永不重叠——一次触发在飞行中时，第二个到期点会被跳过。每次触发结束后，运行记录按每任务保留最新 50 条裁剪。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `scheduleWorkGateway` 服务定义与 `scheduleWork` Remote 投影 |
| [`src/runtime.ts`](src/runtime.ts) | 任务存储、到期排水循环、触发与运行记录生命周期 |
| [`src/domain.ts`](src/domain.ts) | 纯规则校验与基于宿主本地时区的触发点计算 |
| [`src/spec.ts`](src/spec.ts) | `schedule_work` 域声明与持久记录 schema |
| [`src/types.ts`](src/types.ts) | 与浏览器共享的记录、规则与线类型词汇（即 `./types` 导出） |
| — | 不发布运行时不变量伴生包：运行时同时拥有它唯一的跨表关系（运行记录指向它自己写出的任务），独立观察不会分歧。 |

</details>

-----

<a id="dispatch-semantics"></a>
## 触发语义

- **持久事实只有任务记录与运行记录。** `nextRunAt` 是派生投影，每次读取和排水都重新计算；介质从不保存它。
- **补跑是 latest-only。** 错过的日历或固定频率触发点绝不重放；整个窗口只消费一次触发，时间戳取最晚错过的槽位。
- **暂停的任务不触发。** 暂停（`enabled: false`）保留规则与运行历史；恢复后从存储的 `lastRunAt` 重新计算，下次触发永远严格晚于上一次投递。
- **`succeeded` 表示会话回到了空闲。** 它是投递遥测，不是对 agent 工作成果的判断；那由关联会话自己承载。
- **运行历史有界。** 每任务最新 50 条记录留存；更旧的在触发结束后移除。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Schedule 包](../schedule/README.zh.md) —— 会话内提醒，是另一种能力：提醒绑定单个会话并投递到其中，而 schedule-work 任务打开自己的会话。
- [客户端定时工作页面](../../client/ui-schedule-work/README.zh.md) —— 消费本 Remote 命名空间的侧边栏入口、任务目录与编辑器。
- [存储域数据形态](../../../packages/storage/storage-domain/README.zh.md) —— 本包声明表所用的持久介质。
- [权限预设](../../../docs/subsystems/permission-presets.zh.md) —— 完全访问开关指向的预设表。

-----

<a id="model-experience"></a>
## 模型体验

### 定时投递

#### 模型看到什么

每次触发都会把任务的提示词作为所创建会话的首条用户消息投递——那是模型可见输入，由会话自己的日志记录，因此本包不注册自己的提示词段落，也不注册会话事件。任务要求完全访问时，`/permission danger-full-access` 命令先于提示词执行；切换的记录效应归 permission-presets 接缝所有。

#### Token 效应

投递的提示词是唯一新增的请求内容，大小即用户编写的任务提示词。调度元数据——id、规则、运行记录——从不进入请求；本包不设私有的截断或 token 预算。

#### KV Cache 效应

触发只向新会话追加一条普通的排队用户消息；既不替换既有请求 token，也不会把会话拆到多个提供方。所创建会话的前缀复用是 agent loop 自身的约定。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- **仅本地时区** —— 日历规则按宿主时钟解析；没有逐任务的 IANA 时区。
- **不支持 cron 表达式** —— 上述五种规则就是全部语法；"二月的每个工作日"无法表达。
- **补跑不重放** —— 宿主关机期间错过的所有槽位都丢失；在最晚槽位上的一次触发就是全部恢复。
- **无运行中取消** —— 飞行中的触发无法从本包撤回；只能取消会话本身。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

运行时接受 `now: () => Date` 时钟参数；生产用平台墙上时钟，测试钉住显式时刻——不设生产时钟服务。完全访问预设以预置预设表的键寻址，拼成 `/permission danger-full-access` 命令行，因为预设切换是 permission-presets 包自有接缝。

</details>
