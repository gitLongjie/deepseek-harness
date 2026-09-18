---
description: "schedule 组地图：会话本地提醒与应用级定时任务，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# schedule/ — 提醒与定时任务

[English](README.md) | 中文

## 概述

schedule 组承载两类基于时间的自动化。`schedule` 包让 agent（智能体）为当前会话创建、列出和取消提醒：延迟后、绝对时间或固定间隔触发，到期时作为普通消息进入该会话；提醒在重启后依然存在，但不会离开会话，也不会发送电子邮件、短信或推送通知。`schedule-work` 包是"定时工作"页面背后的应用级能力：用户自己编写的任务按日历或固定频率规则打开自己的会话，支持暂停、有效期截止与运行记录。可选的浏览器包显示提醒目录并管理定时任务。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`schedule/`](schedule/README.zh.md) | 会话本地提醒：安排、列出并取消活动记录；发布供 header 目录与列表行标识读取的可选只读 projection；把到期提醒作为会话消息交付 | —（工具只注册在精确的 agent scope 中） |
| [`schedule-work/`](schedule-work/README.zh.md) | 应用级定时任务：按日历或固定频率规则触发到自己的会话中，携带运行记录与 `scheduleWork` Remote 命名空间 | `scheduleWorkGateway` |

-----

<a id="related-documentation"></a>
## 相关文档

- [仅限会话内的 Schedule 子系统](../../docs/subsystems/schedule.zh.md)——持久记录、转换、视图与交付约定。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-schedule)——模型接收的 `schedule_create`／`schedule_list`／`schedule_delete` schema。
- [Schedule 用户指南](../../docs/user/guide/schedule.zh.md)——挂载本包的官方配置路径。
- [Web Schedule 目录](../client/ui-schedule/README.zh.md)——活动记录的可选只读浏览器呈现。
- [定时工作页面](../client/ui-schedule-work/README.zh.md)——应用级任务的侧边栏入口、任务目录、编辑器与运行记录。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
