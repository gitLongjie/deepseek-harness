# Agent Note: 桌面预设组合必须自带 realm 隔离的工作流引擎

Status: implemented

[English](2026-09-29-desktop-presets-realm-engine-row.md) | 中文

## Problem

聘用任何组合里带 delegation 组的专家——即一切 standard 衍生预设，包括用户自建的 H3 视频导演——都被宿主以 `agent-preset/invalid` 拒绝：`tool-workflow` 和 `tool-ralph` "waiting for workflowEngine"。用户完全看不到这个原因：专家广场的聘用按钮是可点的（discovery 只证明插件名可解析），专家页在乐观的 stage 后就关闭了，seat 的错误横幅淡出后标签弹回上一个模式名。而聘用 `geo-optimizer`——它的组合根本没有 delegation 组——一次成功，正是这一点把故障隔离到了组上。

delegation 组把 `workflowEngine` 隔离在 entry-local realm 里，避免两个同时挂载的预设在一个引擎上相撞。realm 会把宿主面上同名服务的提供者对组内行全部隐藏，所以组合必须把引擎提供者放进组内。`7f23db6ba6` 从桌面预设组合里删掉了引擎行，因为 `dsh-workflow-worker-thread` 已成幽灵包（解析不到 → roster 行 broken），但替代提供者（`35af8698c2` 引入的 `dsh-workflow-ptc`）从未补上：`standard` 和 `code` 彻底丢了这一行，`cordis` 保留的名字指向已删除的包。web-app bundle 又有意禁用宿主面的 `workflow-ptc` 行（预设面拥有这些工具），于是任何地方都不再有提供者。

roster 健康检查抓不住这一类问题：它证明插件名可解析，从不证明行能激活——文档化的边界是"永远等待某个服务的行"会在第一个会话上失败。拒绝只会出现在 `select()`，经由挂载门 `inactiveRows`。

## Decision

每个带 `workflowEngine` isolate 组的桌面预设组合都在组内携带 PTC 引擎行，镜像 CLI 发行预设（幸存的正确形态）：

```yaml
- id: workflow-ptc
  name: '@deepseek-ai/dsh-workflow-ptc'
  config:
    provider: spawn
```

`standard` 和 `code` 补上了这一行；`cordis` 的幽灵 `workflow-worker-thread` 行被替换为它。引擎自身的注入（`subagents`、`ptcRuntime`、`sandboxPolicy`）留在宿主面：realm 只隔离声明的那个名字，其余服务照常沿父链解析。

一个结构性 spec（`apps/desktop/tests/preset-compositions.spec.ts`）为每个发行桌面组合钉住不变量：isolate 了某个"有已知提供者清单"服务的组，组内必须携带该清单中的提供者，且任何组合不得引用已删除的包。提供者表刻意是一张小的显式映射（`workflowEngine → dsh-workflow-ptc`），而不是注入推导——yml 表达不了注入，替代方案要 import 每个插件去问。

## Alternatives considered

- **改为重新启用宿主面的 `workflow-ptc` 行。** 拒绝：realm 依旧对组内行隐藏宿主面提供者，工具会继续等待；web-app 禁用该行是预设面所有权的既定设计，不是缺陷。
- **从组的 isolate 映射里删掉 `workflowEngine`。** 拒绝：两个并发挂载的预设会在根 realm 发布相撞的引擎——正是 isolate 要防止的碰撞。
- **让 roster 健康检查通过 import 插件证明激活。** 拒绝：discovery 的契约是不运行插件代码的名字解析；激活证明属于挂载门，而它已经精确报告了。

## Consequences

- `standard`、`code`、`cordis` 在桌面宿主里重新可以新鲜挂载；standard 衍生的专家干净地聘用。
- 从发行组合复制的预设只在发行组合健康时才健康——spec 是保证发行集对副本诚实的那道闸。
- 引擎包再次更换时，spec 里的 `REALM_PROVIDERS` 与 `GHOST_PACKAGES` 随之变更；yml 行和这张表在同一个 PR 里移动。
