# Agent Note: Opening a Workspace directory reaches the file manager

Status: implemented

English | [中文](2026-09-21-open-workspace-directory-in-file-manager.zh.md)

## Problem

"在资源管理器中打开" on a Workspace row did nothing on Windows. Three independent defects sat behind the one click, and only the third explains why the row was inert on every host.

**The plugin never declared the Remote namespace it called.** `ui-workspace`'s browser entry called `ctx.remote.session.openWorkspacePath(...)` while its `inject` listed only `remote` and `remote.directoryPicker`. Cordis resolves `ctx.remote.<ns>` through the traced `remote` service, which throws `cannot get property "remote.session" without inject` for a namespace the fiber did not declare. The throw happens when the callback runs, not at load, so the plugin loaded clean and every other action worked; only the reveal click failed. Git history dates the loss: commit `921b4e1213` added the action with `'remote.session'` declared, and merge commit `581803bf57` resolved the inject line down to the shorter list without it — the sibling `remote.directoryPicker` entry survived, which is why the omission read as deliberate. The renderer logged the throw and the row's `.catch` turned it into `console.warn('workspace directory reveal rejected:', ...)`, so the failure never reached the screen.

**The directory was handed to the shell's default verb.** The row menu called `session/openWorkspacePath` with the Workspace path plus a trailing `/.` — a client-side trick that asked the host's default-application opener to treat a directory as a document. That opener runs `Invoke-Item -LiteralPath <path>` on Windows, and `Invoke-Item` resolves the `Directory` class's default shell verb: a host-mutable registry value under `HKLM\SOFTWARE\Classes\Directory\shell` that on the reporting host reads `none` and names no command at all. The child then exited 0 having opened nothing.

**The shared runner hid the window it was asked to raise.** `runNativeCommand` always passed `windowsHide: true`, and that flag hides the first window the child creates — not merely the transient console of a console-subsystem child. Every Windows file-manager handoff goes through `explorer.exe`, so `revealNativePath`'s `/select,` handoff was already a no-op for the same reason, and routing the directory intent to `explorer.exe` without changing the flag would have changed nothing observable.

The same missing-declaration defect exists in `experimental/client-ui-agent-team`: `mount.ts` exports `inject = ['sessions', 'remote', 'slots', 'locale']` while `registerUi` reads `ctx.remote.agentTeams`. It is a separate pre-existing defect on an experimental surface and is left for its owner.

## Decision

`ui-workspace`'s `inject` declares `'remote.session'` beside the other namespaces it reads, and a spec derives that requirement from the source instead of restating the list: it scans the browser entry for `ctx.remote.<ns>` reads and asserts each is declared. A copy of the declaration list cannot satisfy that check, which is what let the original omission survive a spec asserting the list verbatim. The unit benches provide the namespace so the plugin's own inject declaration stays satisfiable.

The path opener gains a third intent beside `default` and `text-editor`: `openNativeDirectory(path, signal)` hands a directory to the platform file manager. Windows spawns `explorer.exe <path>` directly instead of consulting the shell's per-class default verb; Finder and `xdg-open` receive the directory as before, and WSL paths are translated first.

`runNativeCommand` takes an optional `NativeCommandOptions` whose `windowsHide` defaults to true — the policy that suppresses a console child's transient window. The `NativeCommandRunner` seam carries that option, so the caller states the visibility policy for the command it spawns and an injected runner applies it rather than replacing it: `runExplorer` issues every Explorer handoff as `run('explorer.exe', args, signal, { windowsHide: false })`, which `revealNativePath` and the directory intent share. That seam matters beyond the default, because `open-in-app` injects its own `run` for registry and icon commands and would otherwise lose the policy. Explorer's exit 1 is accepted as a delegated handoff, so the tolerance `revealNativePath` already carried moves into that one helper rather than being written twice.

Every caller that means "this is a directory" now says so instead of hoping the default verb agrees. `SessionOpenWorkspacePathRequest.action` widens from `'reveal'` to `'reveal' | 'directory'`, and `session/openWorkspacePath` dispatches the new variant to a dedicated `openDirectory` handoff (`SessionControllerInternals.openDirectory`, defaulting to `openNativeDirectory`). The Workspace browser's injected action is renamed `openWorkspaceDirectory` and sends `action: 'directory'` with the bare Workspace path; the `/.` suffix and its `workspaceDirectoryPath` helper are gone. `settings/openAgentPresetDirectory` takes `SettingsControllerInternals.openDirectory` and calls it — its `openPath` slot had no other consumer and is removed. `open-in-app`'s `shell-open` launch runs `openNativeDirectory`, so its file-manager entries reach Explorer the same way.

## Alternatives considered

**Keep `Invoke-Item` and fall back to `explorer.exe` when it fails.** `Invoke-Item` exits 0 when the default verb names no command, so there is no failure to detect and no trigger for the fallback. Detecting the misconfigured registry instead would make the harness read `Directory\shell`'s default value on every open.

**Keep `windowsHide: true` and treat the registry as the whole cause.** Measured on the reporting host, `execFile('explorer.exe', [dir], { windowsHide: true })` raises no window and `{ windowsHide: false }` raises it, both exiting 1; `Invoke-Item` on the same directory raises no window either way. The two causes are independent, and a fix for one alone leaves the click inert.

**Drop `windowsHide` for the whole path opener.** The flag is what keeps `powershell.exe`, `wslpath`, and `xdg-open` from flashing a console on every open. Only a child that raises its own window opts out.

**Keep two default runners inside the path opener, one hidden and one visible.** That works for the default adapter but not for a caller that injects its own `run`: `open-in-app` threads its composition runner in for registry and icon commands, and the Explorer handoff would silently inherit the hidden one again. The policy belongs to the command, so it travels as a runner argument.

**Keep the verbatim `inject` assertion as the guard.** It restates the declaration it checks, so it passes for any list the author writes — including the broken one. The derived scan is what makes the requirement falsifiable.

**Spawn `explorer.exe` only for directories, from each caller.** Three packages would each own the same Windows-specific decisions — the command and its visibility flag — and the two that live in `packages/api` would carry a platform branch the path opener exists to hold.

**Keep the trailing `/.` and change only the command.** The suffix is a client-side claim about a path's kind; the host resolves Workspace paths and must be told the kind, not made to infer it from punctuation.

## Consequences

The row's reveal action reaches the Host at all, and the three surfaces that open a directory work on a host whose `Directory` class default verb is unusable; the file-manager reveal that was silently inert on Windows works again. A directory open no longer depends on the client appending punctuation to a host path. `openNativePath` keeps its existing behavior for documents, including the browser preference for HTML and SVG, and its console children keep their hidden windows. The new intent and the runner option are additive to `dsh-native-command`'s public surface; `revealNativePath` keeps its contract (select the file, open its parent on Linux) and only shares the Explorer handoff helper. A caller that passes a file to `openNativeDirectory` gets Explorer raising that file's containing folder on Windows — the intent states what the caller means, and no caller currently does that. `windowsHide` now hides only what its name claims, so any future GUI child must opt out explicitly rather than silently failing to appear.

The missing declaration was invisible because a Remote namespace read happens inside a callback: nothing at load names it, and the unit bench's Remote double is a plain object whose namespace properties never reach Cordis's guard. `SlotTestRuntime` does enforce the declaration, which is why the assembled-renderer bench needed the namespace provided — that failure mode is the check working, not a regression.

## Testing

`packages/client/ui-workspace/tests/apply.client.spec.ts` derives every `ctx.remote.<ns>` the browser entry reads and asserts the `inject` declaration covers it, and drives `openWorkspaceDirectory` through the injected callback to pin the `action: 'directory'` payload and the rejection path. `packages/util/native-command/tests/path-opener.spec.ts` pins the per-platform command for the directory intent, WSL translation before Explorer, the exit-1 tolerance, preserved failures and cancellation, the unsupported platform, that a directory named like a rendered document never reaches the browser branch, and that both Explorer handoffs reach the runner with `windowsHide: false` while every other command keeps the hiding default. `packages/api/session-controller/tests/session-open-workspace-path.host.spec.ts` pins the `directory` action dispatching to the directory handoff instead of the default-application one, and `packages/api/settings-controller/tests/settings-controller.host.spec.ts` pins the preset directory opening through the directory handoff. `packages/host/open-in-app/tests/resolver.spec.ts` pins a `shell-open` launch issuing `explorer.exe`. `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` pins the row menu passing the bare Workspace path and reporting a refused handoff instead of leaving an unhandled rejection. Native desktop verification belongs to Windows: on the reporting host the shipped opener raises the folder window and the reveal handoff selects the file, where both were inert before.
