# Agent Note: desktop preset compositions provide their realm-isolated workflow engine

Status: implemented

English | [中文](2026-09-29-desktop-presets-realm-engine-row.zh.md)

## Problem

Hiring any expert whose composition carries the delegation group — the `standard`-derived presets, including the user-authored H3 video director — was refused by the Host with `agent-preset/invalid`: `tool-workflow` and `tool-ralph` "waiting for workflowEngine". Nothing surfaced this to the person: the market's hire button was enabled (discovery only proves plugin names resolve), the expert page closed on the optimistic stage, and the seat's error banner faded back to the previous mode's name. Meanwhile hiring `geo-optimizer` — whose composition has no delegation group at all — succeeded, which is what isolated the fault to the group.

The delegation group isolates `workflowEngine` behind an entry-local realm so two mounted presets cannot collide on one engine. A realm hides every host-plane provider of that name from the group's rows, so the composition must ship the engine provider INSIDE the group. `7f23db6ba6` dropped the engine rows from the desktop preset compositions because `dsh-workflow-worker-thread` had become a ghost package (unresolvable → broken roster rows), but the replacement provider (`dsh-workflow-ptc`, from `35af8698c2`) was never added: `standard` and `code` lost the row entirely, and `cordis` kept naming the deleted package. The web-app bundle disables the host-plane `workflow-ptc` row on purpose (the preset plane owns the tools), so no provider remained anywhere.

Roster health cannot catch this class: it proves plugin names resolve, never that a row activates — the documented limit is that a row "waiting forever for a service" fails at the first session. The refusal arrives only at `select()`, through the mount gate `inactiveRows`.

## Decision

Every desktop preset composition whose group isolates `workflowEngine` ships the PTC engine row inside that group, mirroring the CLI's shipped presets (the surviving correct form):

```yaml
- id: workflow-ptc
  name: '@deepseek-ai/dsh-workflow-ptc'
  config:
    provider: spawn
```

`standard` and `code` gained the row; `cordis` had its ghost `workflow-worker-thread` row replaced by it. The engine's own injects (`subagents`, `ptcRuntime`, `sandboxPolicy`) stay host-plane: the realm isolates only the declared name, and those resolve through the parent chain like every other non-isolated service.

A structural spec (`apps/desktop/tests/preset-compositions.spec.ts`) pins the invariant for every shipped desktop composition: a group isolating a service with a known provider list must carry one of those providers inside the group, and no composition may name a deleted package. The provider table is deliberately a small explicit map (`workflowEngine → dsh-workflow-ptc`), not an injects-derivation — the yml cannot express injects, and the alternative would import every plugin to ask.

## Alternatives considered

- **Re-enable the host-plane `workflow-ptc` row instead.** Rejected: the realm still hides a host-plane provider from the group's rows, so the tools would keep waiting; the row's disabling in web-app is the intended preset-plane ownership, not the bug.
- **Drop `workflowEngine` from the group's isolate map.** Rejected: two concurrently mounted presets would publish colliding root-realm engines — the exact collision the isolate exists to prevent.
- **Extend roster health to prove activation by importing plugins.** Rejected: discovery's contract is name resolution without running plugin code; activation proof belongs to the mount gate, which already reports it precisely.

## Consequences

- Fresh mounts of `standard`, `code`, and `cordis` work again in the desktop host; an expert derived from `standard` hires cleanly.
- A preset copied from a shipped composition keeps working only while the shipped one does — the spec is the guard that keeps the shipped set honest for copies.
- When the engine package is replaced again, `REALM_PROVIDERS` and `GHOST_PACKAGES` in the spec change with it; the yml rows and the table move in the same PR.
