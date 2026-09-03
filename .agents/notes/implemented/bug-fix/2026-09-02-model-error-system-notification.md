# Agent Note: Model errors use desktop notifications

Status: implemented

English | [中文](2026-09-02-model-error-system-notification.zh.md)

## Problem

Model response failures were surfaced by the conversation composer as transient page Toasts, even though the desktop shell already owns native notifications for background turn completion.

## Decision

Explicit `turn/end` events with an `error` reason use the desktop notification path and include the provider error message in the localized notification body. The composer no longer converts `lastAgentError` into a Toast. Input, attachment, and machine notices continue to use the existing Toast path.

## Alternatives considered

**Keep the model error Toast.** Rejected because a failed background response can be missed when the conversation view is not visible, while the desktop shell can direct the user back to the affected session.

**Notify for every non-completed turn.** Rejected because cancellation and interruption are intentional outcomes and must remain silent.

## Consequences

Background model failures produce a system notification and beep when native notifications are available, and clicking the notification opens the affected session. Focused windows retain the existing silent behavior. The `lastAgentError` session projection remains available for other consumers but is no longer rendered as a composer Toast.

This supersedes the error-toast presentation described in [Conversation attention notices](../feature/2026-09-02-conversation-attention-notices.md).
