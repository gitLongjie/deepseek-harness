# Agent Note: Opening a Workspace directory reaches the file manager

Status: implemented

English | [中文](2026-09-21-open-workspace-directory-in-file-manager.zh.md)

## Problem

"在资源管理器中打开" on a Workspace row did nothing on Windows. The row menu's reveal action called `session/openWorkspacePath` with the Workspace path plus a trailing `/.` — a client-side trick that asked the host's default-application opener to treat a directory as a document. Two independent defects then swallowed the click.

The default-application opener runs `Invoke-Item -LiteralPath <path>` on Windows, and `Invoke-Item` resolves the `Directory` class's default shell verb. That verb is a host-mutable registry value under `HKLM\SOFTWARE\Classes\Directory\shell`: on a host where an installed shell extension rewrote it (the reporting host reads `none`), it names no command at all, so the child exited 0 having opened nothing and the GUI reported no failure either.

The other defect sat in the shared runner. `runNativeCommand` always passed `windowsHide: true`, and that flag hides the first window the child creates — not merely the transient console of a console-subsystem child. Every Windows file-manager handoff goes through `explorer.exe`, so `revealNativePath`'s `/select,` handoff was already a no-op for the same reason, and routing the directory intent to `explorer.exe` without changing the flag would have changed nothing observable.

## Decision

The path opener gains a third intent beside `default` and `text-editor`: `openNativeDirectory(path, signal)` hands a directory to the platform file manager. Windows spawns `explorer.exe <path>` directly instead of consulting the shell's per-class default verb; Finder and `xdg-open` receive the directory as before, and WSL paths are translated first.

`runNativeCommand` takes an optional `NativeCommandOptions` whose `windowsHide` defaults to true — the policy that suppresses a console child's transient window. The `NativeCommandRunner` seam carries that option, so the caller states the visibility policy for the command it spawns and an injected runner applies it rather than replacing it: `runExplorer` issues every Explorer handoff as `run('explorer.exe', args, signal, { windowsHide: false })`, which `revealNativePath` and the directory intent share. That seam matters beyond the default, because `open-in-app` injects its own `run` for registry and icon commands and would otherwise lose the policy. Explorer's exit 1 is accepted as a delegated handoff, so the tolerance `revealNativePath` already carried moves into that one helper rather than being written twice.

Every caller that means "this is a directory" now says so instead of hoping the default verb agrees. `SessionOpenWorkspacePathRequest.action` widens from `'reveal'` to `'reveal' | 'directory'`, and `session/openWorkspacePath` dispatches the new variant to a dedicated `openDirectory` handoff (`SessionControllerInternals.openDirectory`, defaulting to `openNativeDirectory`). The Workspace browser's injected action is renamed `openWorkspaceDirectory` and sends `action: 'directory'` with the bare Workspace path; the `/.` suffix and its `workspaceDirectoryPath` helper are gone. `settings/openAgentPresetDirectory` takes `SettingsControllerInternals.openDirectory` and calls it — its `openPath` slot had no other consumer and is removed. `open-in-app`'s `shell-open` launch runs `openNativeDirectory`, so its file-manager entries reach Explorer the same way.

## Alternatives considered

**Keep `Invoke-Item` and fall back to `explorer.exe` when it fails.** `Invoke-Item` exits 0 when the default verb names no command, so there is no failure to detect and no trigger for the fallback. Detecting the misconfigured registry instead would make the harness read `Directory\shell`'s default value on every open.

**Keep `windowsHide: true` and treat the registry as the whole cause.** Measured on the reporting host, `execFile('explorer.exe', [dir], { windowsHide: true })` raises no window and `{ windowsHide: false }` raises it, both exiting 1; `Invoke-Item` on the same directory raises no window either way. The two causes are independent, and a fix for one alone leaves the click inert.

**Drop `windowsHide` for the whole path opener.** The flag is what keeps `powershell.exe`, `wslpath`, and `xdg-open` from flashing a console on every open. Only a child that raises its own window opts out.

**Keep two default runners inside the path opener, one hidden and one visible.** That works for the default adapter but not for a caller that injects its own `run`: `open-in-app` threads its composition runner in for registry and icon commands, and the Explorer handoff would silently inherit the hidden one again. The policy belongs to the command, so it travels as a runner argument.

**Spawn `explorer.exe` only for directories, from each caller.** Three packages would each own the same Windows-specific decisions — the command and its visibility flag — and the two that live in `packages/api` would carry a platform branch the path opener exists to hold.

**Keep the trailing `/.` and change only the command.** The suffix is a client-side claim about a path's kind; the host resolves Workspace paths and must be told the kind, not made to infer it from punctuation.

## Consequences

The three surfaces that open a directory now work on a host whose `Directory` class default verb is unusable, and the file-manager reveal that was silently inert on Windows works again. A directory open no longer depends on the client appending punctuation to a host path. `openNativePath` keeps its existing behavior for documents, including the browser preference for HTML and SVG, and its console children keep their hidden windows. The new intent and the runner option are additive to `dsh-native-command`'s public surface; `revealNativePath` keeps its contract (select the file, open its parent on Linux) and only shares the Explorer handoff helper. A caller that passes a file to `openNativeDirectory` gets Explorer raising that file's containing folder on Windows — the intent states what the caller means, and no caller currently does that. `windowsHide` now hides only what its name claims, so any future GUI child must opt out explicitly rather than silently failing to appear.

## Testing

`packages/util/native-command/tests/path-opener.spec.ts` pins the per-platform command for the directory intent, WSL translation before Explorer, the exit-1 tolerance, preserved failures and cancellation, the unsupported platform, that a directory named like a rendered document never reaches the browser branch, and that both Explorer handoffs reach the runner with `windowsHide: false` while every other command keeps the hiding default. `packages/api/session-controller/tests/session-open-workspace-path.host.spec.ts` pins the `directory` action dispatching to the directory handoff instead of the default-application one, and `packages/api/settings-controller/tests/settings-controller.host.spec.ts` pins the preset directory opening through the directory handoff. `packages/host/open-in-app/tests/resolver.spec.ts` pins a `shell-open` launch issuing `explorer.exe`. `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` pins the row menu passing the bare Workspace path and reporting a refused handoff instead of leaving an unhandled rejection. Native desktop verification belongs to Windows: on the reporting host the shipped opener raises the folder window and the reveal handoff selects the file, where both were inert before.
