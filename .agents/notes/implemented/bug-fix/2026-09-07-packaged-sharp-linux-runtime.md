# Agent Note: the packaged Linux runtime ships sharp's binding, libvips, and unpacked `.so` files

Status: implemented

English | [中文](2026-09-07-packaged-sharp-linux-runtime.zh.md)

## Problem

The desktop smoke gate failed only on Linux: booting the packaged app rejected the `attachment-local` entry with `Could not load the "sharp" module using the linux-x64 runtime`. Windows and macOS shipped working sharp runtimes because their platform packages are self-contained (libvips DLL/dylib files ride inside `@img/sharp-win32-x64` and `@img/sharp-darwin-*`). The Linux binding instead dlopens `libvips-cpp.so.8.18.3` from a separate package, so three distinct gaps stacked: pnpm 10+ never installs sharp's foreign-platform optional binaries, so electron-builder's walk saw no Linux binding at all; electron-builder collected the packages without their RUNPATH-reachable libvips sibling; and even a correctly collected `.so` stays inside `app.asar`, which `dlopen` cannot read.

## Decision

The desktop manifest declares `@img/sharp-linux-x64` and `@img/sharp-libvips-linux-x64` as `optionalDependencies` — electron-builder's own packaging warning names this as the way to put platform binaries on its walk path, and `optionalDependencies` (not `dependencies`) is what lets pnpm skip them on the other platforms without failing install. `ASAR_UNPACK_GLOBS` gains `**/*.so` and `**/*.so.*`, so the binding's embedded RUNPATH `$ORIGIN/../../sharp-libvips-linux-x64/lib` resolves against real unpacked files when the two packages land as siblings under `node_modules/@img/`. The third-party notice generator gets `OVERRIDES` entries for both packages because pnpm skips foreign-platform optional binaries on every other OS, leaving no local manifest to read licenses from.

## Alternatives considered

**Bundling system libvips via apt in CI.** Rejected: the packaged app must not depend on runner-provided system libraries, and the RUNPATH never searches system paths reliably.

**Switching attachment-local off sharp.** Rejected: an unrelated capability rewrite riding on a packaging fix.

## Verification

`apps/desktop/tests/packaged-resources.spec.ts` locks the `.so` unpack globs. The Linux leg of `desktop-publish.yml` boots the packaged app under xvfb, which exercises the full chain: installed optional binary → bundled sibling package → unpacked `.so` → dlopen success.

## Consequences

All three release platforms pass the packaged smoke gate with the same attachment pipeline. The unpack globs now also unpack any `.so` shipped by other native dependencies, which is the required behavior for Linux-native modules in general.
