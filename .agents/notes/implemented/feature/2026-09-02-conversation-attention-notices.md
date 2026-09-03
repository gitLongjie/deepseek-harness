# Agent Note: Conversation attention notices

Status: implemented

English | [中文](2026-09-02-conversation-attention-notices.zh.md)

## Problem

The conversation shell already receives terminal agent failures and pending user interactions, but the resident composer only surfaced input-machine notices. A failed turn could therefore leave the session looking completed, while a question takeover had no notification in the shared prompt area.

## Decision

`Session` mirrors explicit `turn/end` error reasons from both history and live events into `lastAgentError`, including the provider code and message. The desktop shell presents those failures through native notifications when the window is in the background; `InputBar` does not render the projection as a Toast. `ConversationRoot` presents a localized waiting-for-answer status strip whenever the session has a pending user interaction, outside the composer takeover so the notice remains visible when the default composer is hidden. The pending interaction remains the authoritative answer surface; the status strip is an additional notification and does not change takeover behavior.

## Alternatives considered

**Add a second notification service.** Rejected because the resident composer already owns the product's Toast and status-strip presentation, and the required facts are already available through existing Session and Conversation props.

**Treat every stopped turn as an error.** Rejected because cancellation, interruption, and ordinary completion are distinct durable outcomes; only the explicit agent error fact belongs in the error Toast.

## Consequences

Terminal agent failures remain available in the session projection regardless of whether the error arrived in the initial history window or as a live event, while background failures are announced by the desktop notification path. Pending question, approval, and plan-review interactions share one localized waiting notice outside the takeover layer without duplicating their dedicated composer takeover. Input-related Toasts remain transient, while the waiting notice remains visible until the pending interaction clears.
