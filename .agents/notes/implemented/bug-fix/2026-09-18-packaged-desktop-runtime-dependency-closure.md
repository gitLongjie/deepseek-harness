# Agent Note: The packaged desktop ships its whole runtime dependency closure

Status: implemented

English | [中文](2026-09-18-packaged-desktop-runtime-dependency-closure.zh.md)

## Problem

The minda installer booted on the build machine and failed on the destination machine: `connection` stayed pending waiting for `webRuntime`, and the startup audit killed the app. The packaged app.asar was missing eleven workspace packages (among them `dsh-http-proxy`, `dsh-util-time`, `dsh-ptc-runtime`), and `code`'s roster row named `@deepseek-ai/dsh-workflow-worker-thread` — a package that exists nowhere in the repository. Two mechanisms hid both defects from every check: Node's upward `node_modules` walk escapes `app.asar` and silently backfills from the checkout when the smoke runs inside the repository, and the roster's missing-plugin reason went to a stderr no windowed process reads.

## Decision

The desktop manifest declares the whole runtime closure explicitly — every package the packaged tree imports or a preset row names is a `dependencies` row of `apps/desktop/package.json`; undeclared peer-plus-dev pairs do not survive electron-builder's collection. The smoke gate no longer trusts the checkout: by default it copies the packaged layout under a temporary path containing a space (mirroring `C:\Program Files\...`) and boots the copy, so repository backfill and space-sensitive paths both become first-class failures; `--in-place` opts out. The unpacked runner closure (`dsh-lazy-require`, `dsh-subprocess` for its `control` submodule) is unpacked beside the runner, because a plain-Node child cannot read the archive. The ghost `workflow-worker-thread` rows left the preset compositions instead of shipping a package the workspace does not have.

## Alternatives considered

**Declare each missing package in the package that imports it.** The better long-term shape, and the workspace already carries undeclared-import debt this fix does not pay down; but electron-builder collects from the app manifest's closure either way, and per-package declarations still cannot catch a preset row naming a package no manifest lists. The desktop-level closure plus the outside-repo smoke reject the whole class today.

**Run the smoke from `dist-electron` with the repository renamed away.** Rejected: renaming the checkout per run is slower than a copy and breaks every concurrent use of the repository.

**Leave the smoke in place and add a package-inventory lint.** Rejected: a lint re-derives the closure with its own logic and drifts from the packager's; the copied-layout boot observes exactly what an installed machine observes.

## Consequences

An installer that passes the smoke boots on a clean machine under `Program Files` without the repository present. New undeclared imports now surface at the gate instead of at a customer machine, at the cost of one extra layout copy per smoke run. The ripgrep binary spawns from its `app.asar.unpacked` twin on Windows too — the rewrite matched forward slashes only, so every Windows install had spawned the unspawnable archive path. Composition rows naming packages that no longer exist must be removed with their plugin; discovery marks them broken on machines that lack the accidental backfill, and healthy on machines that have it.

## Verification

`packaged-smoke.mjs` (default path) boots the copied layout from outside the repository with a space in the path; the run that reproduced the destination-machine failure fails exactly there before the fix. `rg-asar-twin-windows.spec.ts` pins the backslash rewrite; `builder-identity.spec.ts` and `packaged-resources.spec.ts` pin the manifest closure and the unpack globs.
