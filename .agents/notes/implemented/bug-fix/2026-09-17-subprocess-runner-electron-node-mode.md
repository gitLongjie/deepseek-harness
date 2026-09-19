# Agent Note: Run the Windows Job runner in node mode inside Electron hosts

Status: implemented

English | [中文](2026-09-17-subprocess-runner-electron-node-mode.zh.md)

## Problem

Every subprocess tool call in the desktop host — pwsh, grep, glob — hung forever: `tool/call` was durably recorded and no result ever arrived, so Stop and Escape could not end the turn and recovery later synthesized `TOOL_OUTCOME_UNKNOWN`. The Windows Job runner spawns its runner child with `process.execPath`; inside the desktop that executable is the application binary, so without the Node switch the child boots a second application instance (whose single-instance lock exits silently, or which sits as a live GUI process) that never speaks the runner control protocol, and `done` never settles. `sandbox-local`'s Windows runner already handles this host form; `subprocess-local` did not.

## Decision

`runnerEnvironment` (`packages/subprocess/subprocess-local/src/runner-launch.ts`) sets `ELECTRON_RUN_AS_NODE: '1'` when the host is Electron, so the runner child runs as plain Node under the same executable. Each spawn builds the target environment on the parent and sends it over IPC, so the switch never reaches a target. `launchWindowsJob` (`packages/subprocess/subprocess-local/src/windows-job.ts`) additionally treats a caller abort that fires before the runner reports a target outcome as infrastructure failure: `done` rejects and the runner terminates. A wedged startup therefore fails at the caller's deadline instead of hanging past it — the tool result settles, the turn closes, and Stop and Escape work.

## Alternatives considered

**Bound the abort drain in the agent loop.** A raced grace period around in-flight dispatches would end the turn despite a hung provider, but it hardcodes a deadline above a seam whose own contract already names the caller signal as the escalation trigger; settling at the spawn seam keeps the loop simple and repairs every consumer at once.

**Resolve the runner to an unpacked on-disk entry.** `sandbox-local` needs that because its runner launches a native executable that cannot live in an archive; the Job runner is pure JavaScript and runs correctly through the application binary in node mode.

## Consequences

Subprocess tools in the desktop execute and settle as they do under plain Node; a startup wedge can no longer outlive the caller's abort, so the cooperative tool timeout and Stop/Escape always unstick a spawn. The pre-result abort rejects `done` with a provider failure (callers already classify it as abort), and a late abort after a delivered result is ignored. `windows-job.spec.ts` pins both; `spawn-runner.spec.ts` pins the switch's presence under Electron and absence under plain Node.
