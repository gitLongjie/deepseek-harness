# Agent Note: Resolve ripgrep for the running architecture

Status: implemented

English | [中文](2026-09-02-ripgrep-runtime-architecture.zh.md)

## Problem

The `@vscode/ripgrep` loader uses `npm_config_arch` when it selects an optional platform binary. That variable describes an installation target and can remain in the environment of an agent launched after a cross-target install. A stale value made the search tools select a binary for the wrong architecture, even though the current Node process and host ripgrep were usable.

## Decision

`dsh-tool-fs-search` sets `npm_config_arch` to `process.arch` only while lazily importing `@vscode/ripgrep`, then restores the original environment entry. The packaged runtime sidecar path remains the first choice. The dependency's own unsupported-platform error remains the fallback when the runtime platform package is unavailable.

## Alternatives considered

**Trust `@vscode/ripgrep` unchanged:** Rejected because its install-time override is not a reliable runtime architecture fact and reproduces as a failed search launch on cross-target environments.

**Use the host `rg` from PATH:** Rejected because search tools must remain self-contained and a PATH executable is not the packaged, controlled binary required by the search security and distribution model.

**Resolve the optional package directly with `process.arch`:** Rejected because it bypasses the dependency's platform resolution and breaks the existing lazy-load and failure diagnostics, including test-time module replacement.

## Consequences

The search tools now select the executable matching the running Node process while preserving the packaged-binary-only policy. The temporary environment override is process-wide during one module import, so resolution remains lazy and memoized; the `finally` cleanup prevents the override from leaking to later code. A regression test covers Windows x64 with `npm_config_arch=arm64`.
