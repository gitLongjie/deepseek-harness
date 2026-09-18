# Agent Note: The client boot drains pending chains by progress, not by a fixed window

Status: implemented

English | [中文](2026-09-18-client-boot-progress-based-settle.zh.md)

## Problem

The renderer's client boot audited activation after a settle window of 8 macrotasks. Waiting fibers drain one dependency level per tick, and the client composition is a deep chain — `ui-directory-picker-native` waits on `slots` and `uiWorkspace`, whose providers wait on further services — so on a slow or cold-start machine the 8-tick budget expired while the chain was still draining, and the boot rejected a tree that was one tick away from healthy. The same build passed on the build machine every time, which made the failure look like a packaging defect it was not.

## Decision

The settle loop is progress-based: each pass snapshots the set of pending and loading entries with their states, and stillness (a pass that changes the snapshot) is counted against a budget of 128 still passes — any change resets the count. The loop returns when nothing is pending or loading, or when the tree has been still for the budget; in-flight work (`loading` fibers) counts as membership in the set, so a pass that changes nothing while a module materializes keeps the boot alive until stillness is real.

## Alternatives considered

**Raise the fixed window (8 → 128).** Rejected: it trades one magic number for another and still fails whichever machine drains one level slower than the budget; the failing condition is "still while draining", not "drained for N ticks".

**Drop the settle loop and audit immediately after `loader.await()`.** Rejected: that is the regression the loop fixed — `loader.await()` settles while waiting rows are one tick from reactivating, so the audit must wait out the per-level reactivation explicitly.

**Wait on loader events instead of ticking.** Rejected for now: the vendored Loader exposes no per-queue-drain event, and synthesizing one duplicates the tick with extra state. Revisit if a still machine ever outlasts the budget.

## Consequences

A genuinely unsatisfied tree (a service nothing provides) still fails the boot, after roughly 128 still passes instead of 8; a draining tree now succeeds regardless of machine speed, because progress — not the clock — decides. A module whose import hangs indefinitely keeps the boot waiting instead of failing; the Loader's own import errors remain the authority for that case.

## Verification

`packages/client/web/tests/boot-client.client.spec.ts` pins the failure report for a service nothing provides (the still path) and the activation report for chains that drain; the destination-machine failure reproduced only outside the build machine, and this change removes the drain-speed dependence the failure rode on.
