# Agent Note: Defer off-screen long-transcript rendering

Status: implemented

English | [中文](2026-09-02-renderer-long-transcript-stall.zh.md)

## Problem

Long sessions could leave the Electron renderer unresponsive while settled assistant answers were parsed, mounted, laid out, and painted together. The `renderer became unresponsive` message is a symptom of this main-thread pressure, not the Electron console-message deprecation warning.

## Decision

Settled assistant Markdown is mounted when its row enters an 800px viewport margin. Streaming and interrupted answers remain immediate so the active turn stays visible. Chat flow rows also opt into Chromium `content-visibility: auto` with an intrinsic fallback size.

## Consequences

Opening a large transcript performs work for the visible conversation first. Scrolling toward older answers mounts them on demand; test and browser environments without `IntersectionObserver` retain immediate rendering.

## Alternatives considered

**Time-slice the initial mount with idle callbacks instead of deferring.** Rejected: settled history still competes with the active stream for the main thread, and the total work stays proportional to transcript length, so the stall narrows instead of disappearing.

**Virtualize the transcript by recycling or dropping older rows.** Rejected: it trades a layout problem for a fidelity problem — in-page search, selection, and scroll anchors over older answers would all regress.
