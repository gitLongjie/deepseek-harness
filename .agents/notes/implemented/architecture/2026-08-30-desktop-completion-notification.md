# Agent Note: Desktop completion notification

English | [中文](2026-08-30-desktop-completion-notification.zh.md)

Status: implemented

## Problem

Desktop users can leave the application window while a model turn is running and receive no signal that the answer is ready.

## Decision

The Electron main process observes live `session/event` records and handles `turn/end`. When the window is neither focused nor destroyed, it emits a native `Notification` and calls Electron's platform beep. Completed, max-token, and error endings alert; user-aborted, cancelled, and interrupted endings remain silent.

Notification and audio failures are isolated so an operating-system limitation cannot affect the host or session lifecycle. The main process owns this behavior because it has authoritative window focus and native-system access; no session event is added to the durable vocabulary.

## Verification

`apps/desktop/tests/completion-notification.spec.ts` covers inactive-window alerts, localized copy, focused-window silence, silent interruption reasons, and unsupported native notifications. Desktop TypeScript compilation passes.
