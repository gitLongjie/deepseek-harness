# Agent Note: 定时工作——应用级定时任务能力与桌面管理页面

Status: implemented

[English](2026-09-19-schedule-work-app-tasks.md) | 中文

## 问题

桌面产品需要一个"定时工作"入口：用户自己建任务，按"每天 09:00"这类日历计划在一个工作空间里运行一条提示词，可暂停、可设有效期、能看到运行记录。现有能力对不上：`dsh-schedule` 的提醒是**会话内**的——记录活在所属会话的事件日志里，投递目标是同一条对话，规则只有 after/at/every（固定频率，无日历语义），没有暂停，也没有面向客户端的读写通道（唯一 UI 是只读的会话头目录）。把这套模型拉去承载产品级定时任务，等于把"属于某个会话的提醒"伪装成"属于用户的任务"，暂停、运行历史、跨会话绑定都只能是假的。

## 决策

新建一条能力缝，两个包，各占一端：

- `packages/schedule/schedule-work`（宿主）：`scheduleWorkGateway` 服务定义 + `scheduleWork` Typert Remote 命名空间（list/listRuns/create/update/removeTasks——线路方法避开保留的 `remove`：它与 Remote 命名空间服务自身成员冲突，客户端 API 会因此拒绝整个命名空间）。持久状态放 `schedule_work` 存储域（storage-domain 的 JSON 文档），绝不进会话日志。运行时持有 30 秒排水定时器；触发 = 经会话控制器建新会话（绑工作空间）→ 按需经命令运行时执行 `/permission danger-full-access` → 把提示词作为首条用户消息入队 → 等 Agent 空闲后定稿运行记录。补跑 latest-only：错过的窗口只在最晚槽位补一次。日历规则按宿主本地时区。
- `packages/client/ui-schedule-work`（浏览器）：`sidebar.panellist` 行 + 同名 keyed `main` 页——这是 panellist 机制的首个占用者；页面经 `ctx.remote.scheduleWork` 读写，工作空间选择器走全局 `useWorkspaces` 钩子。

关键取舍：`nextRunAt` 永不持久化（每次从规则 + `lastRunAt` + 有效期推导，杜绝偏离）；触发按"run 记录 → 原子推进 `lastRunAt` → 建会话"排序，慢建会话不会双发；同任务触发不重叠；完全访问开关走 `/permission` 命令这条 permission-presets 自有接缝，命令不可用时触发按失败收场而不是用默认权限悄悄继续。`dsh-schedule` 保持原样：提醒归会话，定时任务归应用。

## 备选方案

**扩展 dsh-schedule 的 change 联合加 pause、加日历规则、加应用级存储。** 否决：那会把"会话日志折叠出来的投影"与"应用级记录"两种持久模型焊进一个包；会话 fork 继承语义（按 `inheritedEventCount` 切断）对应用级任务毫无意义，还得改持久类型联合并迁移。

**客户端直接驱动：页面里算时间、经 session.create/prompt Remote 投递。** 否决：桌面应用一关，任务就没人跑了；调度必须住在宿主进程里。

**复用 storage 域 + 让 agent 工具读写。** 否决：用户操作不该依赖模型转会工具；Remote 直达存储是确定性通道，工具留给 agent 自主场景。

## 后果

桌面图谱默认挂载两行，无需 overlay；`~/.dsh/storages/schedule_work.json` 是唯一的任务/运行状态介质。运行记录每任务保留 50 条，裁剪发生在触发结束后。日历规则没有逐任务时区、没有 cron 语法、关机期间的错过不重放——这些限制都写进了包 README。侧边栏 panellist 有了第一个真实占用者，后续全局面板（若有）照此模式接入。

## 验证

`packages/schedule/schedule-work/tests/domain.spec.ts` 钉住规则校验与本地时区触发点计算（含补跑窗口）；`tests/runtime.spec.ts` 在真实存储域 + 内存后端上钉住建/改/删/持久重启、latest-only 补跑、暂停跳过、有效期、完全访问命令与失败路径、飞行中不双发；`tests/gateway.spec.ts` 钉住 Remote 投影与错误码映射；`packages/client/ui-schedule-work/tests/schedule-work-page.client.spec.tsx` 钉住目录渲染、筛选搜索、批量、对话框创建/编辑、运行记录与双语词典。
