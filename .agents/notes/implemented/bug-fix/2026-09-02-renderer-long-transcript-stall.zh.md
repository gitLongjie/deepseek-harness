# Agent Note: 延迟渲染屏幕外的长会话内容

Status: implemented

[English](2026-09-02-renderer-long-transcript-stall.md) | 中文

## Problem

长会话会让 Electron Renderer 同时解析、挂载、布局和绘制所有已完成的 Assistant 回答，导致主线程长时间无响应。`renderer became unresponsive` 是主线程压力的症状，不是 Electron `console-message` 弃用告警的原因。

## Decision

已结束的 Assistant Markdown 在聊天行进入视口前 800px 范围时才挂载。流式和中断回答仍然立即渲染，保证当前轮次可见。聊天流行同时启用 Chromium `content-visibility: auto` 和固有尺寸回退。

## Consequences

打开大 transcript 时优先处理当前可见内容。滚动接近历史回答时按需挂载；没有 `IntersectionObserver` 的测试和浏览器环境继续使用立即渲染。

## Alternatives considered

**用空闲回调对初次挂载做时间分片，而不是延迟渲染。** 否决：已完成的历史内容仍会与活跃流式输出争抢主线程，总工作量依旧与 transcript 长度成正比，只是把卡顿收窄而不是消除。

**通过回收或丢弃历史聊天行做虚拟化。** 否决：这把布局问题换成了保真度问题——针对历史回答的页内搜索、选中和滚动锚点都会退化。
