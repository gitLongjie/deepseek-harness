# Agent Note: 会话控制器 wire 订阅在重载时释放

Status: implemented

[English](2026-09-21-session-controller-wire-subscription-disposal.md) | 中文

## Problem

桌面主窗口冻结（renderer 连续数小时烧 CPU）在日志里留下两个事实：`dsh-api-session-controller` 的 client entry 反复重新激活——长会话中累计数百次——且 preload 桥最终告警 `11 dsh:stream:frame listeners added`。每次重激活都会重跑 entry 的 `apply`，而它注册的六个 wire 订阅（`api-session/*` Remote 事件、`connection/reset`、typert 的 `agent` client adapter）**从未保存 disposer**。旧订阅持续向已退役的 `ClientSessions` 实例投递事件，每次会话列表事件都多付一遍完整处理成本，renderer 的事件处理无界增长，直到主线程饿死。

让 entry 首次重启的触发源仍未定位（间隔从数秒到数小时不等，只有这一个 entry 在循环，其余 loader entry 均安静）。但泄漏是把一次重启变成无界成本曲线的原因；成本不再累积后，重启本身很廉价。

## Decision

`packages/api/session-controller/src/client/index.ts` 现在把全部 wire 订阅注册进一个 `ctx.effect`，entry 重载时先撤上一轮激活的订阅再绑定新的一轮。排查中发现的两个同形泄漏一并修复：`ui-approval` 的 `approval/request` waterfall 监听、`ui-commands` 的 `commands/change` / `agent-preset/selected` / `connection/reset` 订阅，全部移入 `ctx.effect`。

## Alternatives considered

**先抓重启触发源。** 没有泄漏时重启成本有界，修泄漏即可消除冻结，触发源可以继续观察；抓它需要一次带插桩的长运行。

**在 `ClientSessions` 内部清理监听。** 退役实例无法撤销不归它持有的订阅；所有权在 `apply` 的注册点。

## Consequences

重激活现在的成本是一次有界的 `apply`，而不是一条永久的订阅。Remote 事件 waterfall 和 `connection/reset` 处理不再打进退役的会话状态，顺带消除了旧实例造成的幽灵列表更新。重启触发源仍未闭合：下一次冻结的前兆是 `desktop.log` 中 `[boot] Nms entry @deepseek-ai/dsh-api-session-controller -> active` 且 `N` 持续增长；在它复现前挂上 CDP 探针（`--remote-debugging-port`）可以抓到重启时的调用栈。
