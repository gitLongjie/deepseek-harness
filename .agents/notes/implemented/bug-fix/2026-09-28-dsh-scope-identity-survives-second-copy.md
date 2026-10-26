# Agent Note: dsh-scope identity survives a second copy of the package

Status: implemented

English | [中文](2026-09-28-dsh-scope-identity-survives-second-copy.zh.md)

## Problem

`tool-subagent`'s standing `modelSelectionSettings` path validates its composition scope with `scopeOf(ctx)` at mount time. In the packaged desktop app this check failed for every preset whose `tool-subagent` row sets `modelSelectionSettings: true` (the shipped `standard`, `cordis`, and `ptc` compositions), so clicking new session on those experts produced `SessionCreateError … preset "standard" failed to mount: tool-subagent: standing 'modelSelectionSettings' requires a scoped preset Context`, while presets without the row mounted fine.

The mount was scoped; the READ was blind. `dsh-scope` held its tag symbol (`Symbol('dsh.scope')`) and its parent-chain/carrier state (`WeakMap`s) in module-private storage. The failing deployment materialized two copies of the package in one process — the installed app resolves host-composition rows through the shared `~/.dsh/profiles/node_modules` junction farm beside its own packaged copy, and on this machine the farm mixed packages from two checkouts. `agent-presets` minted the standing scope through one copy of `dsh-scope`; `tool-subagent` probed through another, whose private symbol and empty `WeakMap`s could not see any of it. `scopeOf` answered `undefined`, and the mount rejected its own composition.

## Decision

The identity moves to process-global storage, the same remedy vendored Cordis applies to `Context.is` (`Symbol.for('cordis.is')`):

- `kScope` becomes `Symbol.for('dsh.scope')`, so every copy tags and reads the same context property.
- The parent-chain and carrier weak maps move under a namespaced `globalThis` key (`dsh.scope.state`), so one copy's `bindScopeParent` stays readable by another copy's `scopeChainOf` and the invariant companion's carrier checks keep working across copies.

`Symbol.for`'s collision namespace is acceptable here: the tag carries no user data, and the string is package-namespaced. `ScopeKey` objects themselves were already instance-independent (plain objects shared through the context).

## Alternatives considered

**Fix only the deployment (heal the junction farm, resolve everything from the asar).** Rejected as the sole remedy: the resolution paths that mix copies are load-bearing for several layouts (packaged host beside a writable profile, dev beside a healed farm), the farm is user-machine state any checkout can rewrite, and a library whose correctness depends on never being loaded twice will fail again on the next machine that does. Deployment hardening remains worthwhile but cannot be relied on.

**Move the standing-scope validation out of `tool-subagent` (trust `mountPreset`'s own scope check).** Rejected: the row check catches a different failure — a direct `apply()` in an unscoped standing context that `mountPreset` never saw — and removing it would turn a loud load-time rejection into silent process-global tool registration.

## Consequences

- Mixed-copy deployments compose scoped presets correctly: the row-level `scopeOf` probe reads a tag another copy wrote, and parent-chain walks (`scopeChainOf` in `belongsToComposition`) see links another copy bound.
- Two processes do NOT share identity — the state is per-process global, not persisted; scope keys stay process-local exactly as before.
- A stale copy of the old code beside a fresh copy still cannot read the fresh copy's tags (the old copy writes under its private symbol); the fix takes effect only once every loaded copy is rebuilt, i.e. after an app restart on rebuilt artifacts.

## Testing

`packages/core/scope/tests/scope.spec.ts` gains a cross-instance identity case: a second copy of the module (query-string import, a distinct ESM record) must read the tag, parent link, and chain the first copy wrote, and a scope minted through the second copy must be visible to the first. The dual-copy failure mode was also reproduced end-to-end before the fix — `createScope` from one instance, a preset row's `scopeOf` from another, yielding the exact reported mount error — and the same harness reads `present` on every instance after the fix.
