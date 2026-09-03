# Agent Note: Escape stops the active Session

Status: implemented

English | [中文](2026-09-02-escape-stops-active-session.zh.md)

## Problem

The conversation composer exposes Stop through a pointer control, but a user cannot terminate the current running Session from the keyboard. Escape already participates in popup and input-method handling, so a new stop gesture must preserve those higher-priority uses.

## Decision

The Lexical composer keymap calls the existing injected Stop operation when Escape is not consumed by popup arbitration and the current Session is running. The input bar reports whether it actually consumed the gesture, so locked, absent, or non-running Sessions leave Escape untouched. Escape observed during IME composition is reserved for composition cancellation and never stops the Session.

## Alternatives considered

**Add a separate document-level keyboard listener.** Rejected because the active composer already owns the focused Escape command layer and has the popup, composition, and Session state needed to order the gesture correctly.

**Stop before popup arbitration.** Rejected because Escape must close an open popup without also terminating the running Session.

## Consequences

Users can stop a running current Session with Escape while focused in the composer, and the existing Session Controller cancellation path remains the only stop implementation. Popup dismissal and IME composition cancellation retain precedence. Escape outside the composer remains available to browser and other UI behavior.
