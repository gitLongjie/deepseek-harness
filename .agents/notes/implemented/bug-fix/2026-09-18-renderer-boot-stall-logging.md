# Agent Note: The renderer boot logs its progress and warn-snapshots stalls

Status: implemented

English | [中文](2026-09-18-renderer-boot-stall-logging.zh.md)

## Problem

A packaged desktop boot wedged in the renderer left no durable trace: desktop.log recorded the host boot and the window load, then nothing, while the window sat on the plugin-loading screen forever. [The settle fix](2026-09-18-client-boot-progress-based-settle.md) had already acknowledged that an import which never settles keeps the boot waiting instead of failing, and a destination machine running the packaged shell showed exactly that — no failure dialog, no log line naming the stuck stage, entry, or bundle. The desktop shell mirrored only renderer console warning and error lines, and the boot chain emitted neither; the `loadBundle` IPC handler and the renderer's bundle fetches were silent too.

## Decision

The client boot chain logs its own progress through the `[boot]` console prefix (`@deepseek-ai/dsh-client-web` boot-log). `AppWebEntry` emits one line per stage: boot-ready gate, module-system build with manifest statistics, prefetch start and finish, mount, boot finished. `bootClient` emits every entry-state transition, every settle-pass membership change, and the settle give-up with each entry's reason. A stall watchdog warn-snapshots the non-active entries — with the services each pending entry waits on — every 10 seconds until boot settles either way. The audit's failure formatting is extracted into `inactiveEntryLines`, so the watchdog, the settle give-up, and `assertEntriesActive` word failures identically.

The desktop shell completes the sink: it mirrors `[boot]`-prefixed renderer info lines into desktop.log beside the existing unconditional warning/error mirroring, logs the composed client graph's shape after the host settles and the injection-table shape at index render (naming a table without application batches, and the packaged recovery bootstrap when the graph lost client-modules), and logs each `loadBundle` IPC request with its outcome, byte count, and duration. The desktop render transport logs each bundle fetch from the renderer side, so a fetch that never reaches the main process is distinguishable from one the main process never answered. The packaged smoke gains a `client-graph` check that fails when no application client entries composed — the failure every earlier check was blind to. `deploy-app.mjs` rebuilds the workspace lib artifacts before packaging: a pack over stale libs ships a payload whose client scan resolves nothing, silently.

## Alternatives considered

**A dedicated boot-diagnostics IPC channel to the main log.** Rejected: the `console-message` mirroring already carries every renderer console line; a second channel duplicates the sink and adds preload surface for no extra fidelity.

**Fail the boot on a timeout.** Rejected for now: it changes when boot settles, and a slow machine could be failed spuriously; the current defect is missing observability, and the watchdog diagnoses it without changing settlement. Revisit if silent hangs recur once the stuck stage is identifiable.

**Instrument the main process only.** Rejected: the wedge lives in the renderer's plugin activation, which the main process cannot see.

## Consequences

A wedged boot now names its last stage, its last entry transition, and — within 10 seconds — the exact entries still inactive and the services they wait for. A served web run gets the same lines in devtools. The `[boot]` prefix is a contract between client-web's boot logger and the desktop main's mirroring filter; changing either side requires the other. Boot lines add one renderer console line per entry-state transition, mirrored only in desktop.log. A pack over stale workspace libs now rebuilds them first (costing minutes per pack) instead of shipping a payload whose plugin-loading screen never leaves.

## Verification

`packages/client/web/tests/boot-client.client.spec.ts` pins the watchdog (interval snapshots, silent empty snapshots, stop), the `inactiveEntryLines` wording shared with the audit, and the settle give-up warning; the boot and mount specs exercise every stage line. `tsc -b` passes for `packages/client/web` and `apps/desktop`. The instrumentation located the plugin-loading stall on the first instrumented run: the new graph, table, and index-size lines reduced it to [the client-scan resolution-base defect](2026-09-18-client-scan-resolves-from-installed-host.md) — one application entry and a 47,505-char index on a real install, the full roster (61 entries, ~12.6MB) once that fix landed.
