# Agent Note: Desktop Electron host runs the sandbox runner in Node mode

Status: implemented

English | [中文](2026-09-01-desktop-electron-node-mode-runner.zh.md)

## Problem

The packaged desktop app boots the harness tree in-process inside the Electron main process, so every `process.execPath` read in a harness service is `Deepagens-Worker.exe`, not Node. The Windows ACL sandbox seam resolves its runner to `[process.execPath, lib/runner.js, …]`; in the packaged app that argv launches a second application instance instead of the runner, and the app's single-instance lock exits that second launch immediately with exit code 0 and no output. Every confined command therefore "ran" as an empty result — pwsh produced no stdout, no stderr, and a success exit code, with no diagnostic anywhere — while local (source) development, whose `process.execPath` is a real Node binary, worked fine. The functional windows-acl probe passed for the same reason (the second instance also exits 0), so nothing failed closed.

## Decision

The runner program slot keeps the `[node, runner, …]` argv contract, and the seam gains the environment half of that contract:

- `ConfinedArgv` carries an optional `env`: the entries the wrapped argv's DIRECT spawn requires. The sandboxing shell executors (bash and pwsh) merge it into their spawn environment after their own entries.
- Inside an Electron embedding (`process.versions.electron` set), `dsh-sandbox-local` resolves the windows-acl runner to an entry that exists on disk — the `app.asar.unpacked` twin of the archive-resolved built entry, the built entry itself on an open checkout, or the package source through tsx — and reports `ELECTRON_RUN_AS_NODE: '1'` on the wrap's `env`. `existsSync` sees inside asar archives under Electron, so it is trusted only for non-asar paths; an archive-resident entry with no unpacked twin resolves to nothing and `confine()` throws `SANDBOX_UNAVAILABLE` (fail closed) instead of spawning a runner that cannot start.
- The desktop packager unpacks the runner's load closure (`@deepseek-ai/dsh-sandbox-windows-acl`, `@deepseek-ai/dsh-win32-process`, `koffi`) to disk, because Node mode has no asar support.
- The runner deletes `ELECTRON_RUN_AS_NODE` from its own environment before spawning the confined child (the child inherits the runner's block through `lpEnvironment NULL`). Deletion passes `null` to `SetEnvironmentVariableW`: an empty string leaves an empty entry, which an Electron child still reads as run-as-node (verified empirically). The `setEnvironmentVariableW` binding type widened to accept `string | null`.

## Alternatives considered

**Handle a runner marker flag in the desktop app's main entry.** The packaged exe could dispatch `--dsh-sandbox-runner …` to an in-process runner invocation. Rejected: it couples a generic sandbox package to a specific embedding application's CLI, and the runner would execute inside a GUI-subsystem process whose console/stdio behavior is not under the sandbox's control.

**Ship a real node.exe or a native runner binary.** A native-exe runner is the documented future of the argv contract, but until one exists the Electron binary in Node mode is the only Node runtime guaranteed present, and electron-builder does not ship a standalone node.

**Set `ELECTRON_RUN_AS_NODE` on the host process environment.** The desktop main process could export it once for all children. Rejected: Electron's own spawned helper processes inherit the host environment, and flipping their runtime mode breaks the app.

## Consequences

Confinement works inside the packaged desktop app: the runner runs as plain Node, the confined child inherits a clean environment, and a deployment that forgets the unpack step fails loudly (`SANDBOX_UNAVAILABLE`) instead of silently returning empty results. The cost is a small unpacked footprint (three node_modules subtrees) and a seam contract one field wider. A JS runner spawned by the seam now legitimately carries required environment, so future runner programs must keep the runner-owned scrub discipline for anything the confined child must not see.

## Testing

`sandbox-local`'s electron-host spec pins the resolution matrix (unpacked twin, missing twin fail-closed, disk entry, plain Node host, operator override, probe env merge) on every platform; `sandbox-windows-acl`'s runner suite spawns the real entry with `ELECTRON_RUN_AS_NODE=1` set and asserts the confined child does not see it; the pwsh-sandbox and bash-sandbox suites pin the `env` merge on foreground and background spawns. A full `electron-builder --dir` run (the `desktop-build.yml` packaging path) verified the unpack rules on the produced artifact: the runner package, `@deepseek-ai/dsh-win32-process`, `koffi`, and the `@koromix/koffi-win32-x64` native binding all land under `app.asar.unpacked/node_modules/`, and the packaged `Deepagens-Worker.exe` booted with `ELECTRON_RUN_AS_NODE=1` executes that runner, which confines a working `cmd` child that does not see the switch.
