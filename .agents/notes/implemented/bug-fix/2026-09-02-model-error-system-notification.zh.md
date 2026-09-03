# Agent Note: Model errors use desktop notifications

Status: implemented

[English](2026-09-02-model-error-system-notification.md) | 中文

## Problem

模型回答失败以前由对话 composer 通过页面临时 Toast 展示，即使桌面外壳已经为后台轮次完成拥有系统通知能力，错误也没有使用该能力。

## Decision

带有 `error` 原因的明确 `turn/end` 事件使用桌面系统通知路径，并在本地化通知正文中包含提供方错误消息。composer 不再把 `lastAgentError` 转换为 Toast。输入、附件和输入机提示继续使用现有 Toast 路径。

## Alternatives considered

**保留模型错误 Toast。** 不采用：当后台回答失败且对话视图不可见时，用户可能错过错误；桌面外壳可以把用户直接带回受影响的会话。

**为所有非完成轮次发送通知。** 不采用：取消和中断是有意的结束结果，应保持静默。

## Consequences

后台模型失败会在原生通知可用时产生系统通知和提示音，点击通知会打开受影响的会话。窗口处于焦点状态时沿用现有静默行为。`lastAgentError` 会话投影仍可供其他消费者使用，但不再由 composer 渲染为 Toast。

本决定取代 [Conversation attention notices](../feature/2026-09-02-conversation-attention-notices.zh.md) 中记录的错误 Toast 展示方式。
