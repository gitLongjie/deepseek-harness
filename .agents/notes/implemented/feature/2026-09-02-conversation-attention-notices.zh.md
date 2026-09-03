# Agent Note: Conversation attention notices

Status: implemented

[English](2026-09-02-conversation-attention-notices.md) | 中文

## Problem

对话外壳已经收到智能体终止错误和等待用户参与的交互状态，但常驻 composer 只展示输入机通知。因此出错轮次停止后可能看起来像普通完成，提问接管 composer 时也不会在共用提示区提示用户。

## Decision

`Session` 会把历史窗口和实时事件中的明确 `turn/end` 错误原因同步到 `lastAgentError`，其中包含提供方错误码和消息。桌面外壳在窗口位于后台时通过系统通知展示这些错误；`InputBar` 不再把该投影渲染为 Toast。`ConversationRoot` 在会话存在待处理用户交互时展示本地化的等待提示条；提示条位于 composer takeover 层之外，因此默认 composer 被隐藏时仍然可见。待处理交互仍是权威回答界面，提示条只是附加通知，不改变接管行为。

## Alternatives considered

**新增通知服务。** 不采用：常驻 composer 已经拥有产品的 Toast 和提示条展示能力，而所需事实已经通过现有 Session 与 Conversation props 提供。

**把所有停止的轮次都视为错误。** 不采用：取消、中断和正常完成是不同的持久化结果，只有明确的智能体错误事实进入错误 Toast。

## Consequences

智能体终止错误无论来自初始历史窗口还是实时事件，都会继续保留在会话投影中；后台错误通过桌面通知路径提示。提问、审批和计划审阅在 takeover 层之外共享一条本地化等待提示，同时保留各自专用的 composer 接管界面。输入相关 Toast 仍是临时提示，等待提示会持续到待处理交互清除。
