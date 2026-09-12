# Agent Note: Desktop plugin toggle rides the home patch layer

Status: implemented

English | [中文](2026-09-12-desktop-plugin-toggle-home-patch.zh.md)

## Problem

The desktop shell exposes plugin inventory surfaces, but enabling or disabling a plugin required hand-editing `$DSH_HOME/cordis.patch.yml` — knowing the file format, the plugin id, and that the app re-reads the file on config HMR. A settings toggle needs a main-process way to read and flip that one `disabled: true` row without corrupting a file users may have hand-edited.

## Decision

`apps/desktop/src/main/ipc/plugin-toggle.ts` registers two IPC handlers: `dsh:plugin:isEnabled` reports whether a plugin id carries `disabled: true` in the home patch, and `dsh:plugin:setEnabled` writes or removes that row. The parser accepts only the flat `- id:` / `disabled:` form (plus the serialized empty layer `[]`) that the module itself writes; any unrecognized line bails out to an empty list, so a hand-edited file with richer patch rows is reported as enabled and never rewritten into something else. Serialization always emits a top-level YAML array — the app-boot patch loader rejects any other shape, and that rejection fails desktop startup. Enabling removes the whole entry rather than flipping `disabled: false`, so the file stays minimal.

## Alternatives considered

**A settings-owned JSON sidecar.** Rejected: the home patch layer is already the plugin-composition override surface the boot reads on config HMR; a second file would need its own loader and would drift from hand-edited patches.

**Flipping `disabled: false` in place.** Rejected: it keeps a no-op row per re-enabled plugin forever and makes the minimal hand-editable form harder to see.

## Verification

`apps/desktop/tests/plugin-toggle.spec.ts` drives both handlers against a temp home: enabled-by-default with no file, disable serializing as a top-level array, the re-enabled empty state serializing as `[]`, sibling entries surviving a toggle, and home-directory creation. `pnpm --filter @deepseek-ai/dsh-desktop run test` passes.

## Consequences

The channels are live in the main process but no in-repo renderer consumes them yet — the settings row that calls them ships separately, so until then the handlers are inert. Toggling takes effect without a full restart only while config-only HMR is active; otherwise the next launch picks the file up. A user who hand-writes a richer home patch is read as enabled and protected from rewrites by the parser's bail-out, at the cost that the toggle cannot represent their rows.
