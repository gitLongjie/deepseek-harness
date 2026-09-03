# Agent Note: Desktop artifacts ship behind a packaged boot smoke gate

Status: implemented

English | [中文](2026-09-03-desktop-packaged-smoke-gate.zh.md)

## Problem

Desktop installers repeatedly shipped missing one runtime resource or another — the local dsh-im runtime, the esbuild platform binaries, the frontend dist, the Node-mode sandbox runner's unpacked closure — and each miss surfaced only on an installed copy, because nothing between packaging and publication ever booted the artifact. CI packaged on three platforms but never launched the output, and publish uploaded straight from the build job. The completeness knowledge lived in hand-maintained lists — `electron-builder.yml`'s `asarUnpack` globs, `deploy-app.mjs` staging steps, `import.meta.url`-relative directories — with no automated check tying them to what the app actually reads at runtime, and the packaged app itself started silently broken instead of refusing to boot.

## Decision

- The desktop package owns `src/main/desktop/packaged-resources.ts` as the single source of truth for its on-disk runtime resources: `ASAR_UNPACK_GLOBS`, which `deploy-app.mjs` imports from the built output and injects into the generated electron-builder overlay, and `findMissingPackagedResources`, the boot-time completeness assertions. `electron-builder.yml` no longer declares `asarUnpack`; the manifest and the assertions cannot drift apart because they are one module.
- Every packaged launch asserts completeness before the host tree mounts — web dist, shipped agent presets, the desktop patch, the workflow worker entry, and on Windows the unpacked twins of the sandbox runner chain and koffi — and fails loud with a localized native dialog plus log and exit 1, instead of half-working.
- `DSH_PACKAGED_SMOKE=1` turns the packaged app into the smoke target: the harness launches it with isolated `userData`, `DSH_HOME`, log, and verdict-file paths, and after the host boots, the main process runs the self-check suite instead of starting the shell — the settled IPC carrier services, a preset-roster read in which every shipped preset must resolve from the packaged node_modules, the real frontend index render, a ripgrep spawn, the workflow worker subpath resolution through the packaged node_modules, and on Windows the koffi native load through the archive-side resolution and a Node-mode sandbox runner run that must answer with the runner's `windows-acl-run:` bad-argv exit-127 signature. Exit 0 without the signature is the historical second-app-instance failure, so the signature, not the exit code, is the pass condition.
- `pnpm --filter @deepseek-ai/dsh-desktop run smoke` packages `--dir`, boots the real unpacked artifact, and gates on the verdict; `--publish` runs the release build only after a passing smoke. The publish workflow's platform jobs run this gate between build and publication, and the desktop pre-push evidence includes the smoke for packaging-surface changes.

## Alternatives considered

**Keep CI building without booting and extend the static globs.** Cheaper, but static completeness cannot see what the runtime reads; five consecutive esbuild-platform-binary fixes and the dsh-im, frontend-dist, and runner misses all came from exactly that blindness.

**Fail-loud startup assertions only, no smoke gate.** The assertions cover only resources someone remembered to add to the manifest, and they check presence, not loadability. The smoke catches any missing resource that participates in boot and exercises the real loads and spawns (native binding, Node-mode runner, ripgrep) that file checks cannot.

**Publish first and smoke the release assets as a canary.** Rejected: by the time the smoke runs, the broken artifact is already the release; users on the update feed consume it.

**Smoke in the PR packaging matrix (`desktop-build.yml`).** Deferred: it would add minutes to every desktop PR while the unrecoverable moment is publication, not pull-request review; the publish workflow is where the gate belongs.

## Consequences

The publish workflow now builds the desktop twice per platform (the smoke's `--dir` run, then the release build) and the smoke adds a boot's worth of minutes; local iteration re-runs with `--skip-build` against an existing `dist-electron` artifact. In exchange, no artifact reaches the release or a user without a boot-verified resource set, a packaging-list regression fails at the gate with the missing resource named, and any future miss that slips past the gate still fails loud at startup with a localized dialog instead of silently misbehaving. The Windows-only twin assertions stay platform-scoped so non-Windows artifacts neither fail nor silently skip their own platform's checks. The smoke inherits the app's single-instance lock design, so the harness isolates `userData` before module init — the same lock that once swallowed the runner launch.

## Testing

`apps/desktop/tests/packaged-resources.spec.ts` pins the manifest globs and the per-label missing-resource reports across packaged and checkout layouts on both platforms, and `builder-identity.spec.ts` covers the overlay contract carrying `asarUnpack`. The end-to-end gate is `pnpm --filter @deepseek-ai/dsh-desktop run smoke`: on Windows it boots the real artifact and passes with every check green, which the publish workflow repeats on all three platforms.
