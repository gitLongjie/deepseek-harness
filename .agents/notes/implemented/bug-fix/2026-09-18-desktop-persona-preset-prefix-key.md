# Agent Note: Rename the desktop presets' persona row key after the upstream `text`→`prefix` change

Status: implemented

English | [中文](2026-09-18-desktop-persona-preset-prefix-key.zh.md)

## Problem

Upstream 40792330c0 renamed the `dsh-persona` row's required config key from `text` to `prefix` (`packages/preset/persona/src/index.ts`), and the merge bb1a3b16bb carried that rename into deepagens. The desktop-only preset copies that upstream does not know — all six `apps/desktop/config/agent-presets/*/agent.cordis.yml` and the two synced `experts/expert-*/experts/*/agent.cordis.yml` copies — still wrote `text:`. Every preset mounting a persona row now failed schema validation (`$.prefix missing required value`), so creating any session through the desktop/web GUI rejected with `agent-preset/invalid`. The renderer's `startSession` logs that rejection only to the console (`new session failed:`), so the visible symptom was the sidebar's 新会话 button doing nothing at all.

## Decision

Rename the persona row key `text:` → `prefix:` in the six `apps/desktop/config/agent-presets/` presets and regenerate the two expert packages' synced copies with their `scripts/build.mjs` (the desktop config remains the source of truth the expert builds copy verbatim). Machines with an authored copy under `~/.dsh/.agent-presets/` need that installed file renamed too; the expert sync plugins overwrite drifted copies only for presets they ship, so an already-authored article-publisher copy keeps the stale key until edited.

## Alternatives considered

**Accept `text` as a legacy alias in the persona schema.** The rename is upstream's released shape and the deployment presets are the only stale writers; an alias would preserve a name the row's own JSDoc and every upstream preset have already dropped.

**Surface the create failure in the client UI.** Worth doing, but orthogonal: the preset config is still invalid and every session create would still fail until the file is fixed. The silent `console.warn` swallow is recorded as a follow-up, not a substitute for repairing the composition.

## Consequences

新会话 creates a session again on desktop and web profiles whose persona presets come from `apps/desktop/config/agent-presets/`; verified live by clicking the sidebar button against a `dsh web` profile (create succeeded, no console rejection). Any deployment that hand-authored persona presets between the merge and this fix must rename the key in its installed `~/.dsh/.agent-presets/<name>/agent.cordis.yml`.
