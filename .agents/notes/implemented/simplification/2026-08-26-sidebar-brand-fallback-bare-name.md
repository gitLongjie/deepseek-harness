# Agent Note: Sidebar brand fallback is the bare product name

Status: implemented

English | [中文](2026-08-26-sidebar-brand-fallback-bare-name.zh.md)

## Problem

When no package fills `sidebar.brand.name`, the sidebar shell rendered the fallback as `喵喔科技 Local Build` plus a badge carrying the build's 7-character `DSH_CLIENT_COMMIT_HASH`. The suffix and badge duplicate build metadata the window title already carries, clutter the brand row — whose expanded form doubles as the New Session button — and read as internal build jargon in a user-facing seat.

## Decision

The fallback renders the bare `喵喔科技` label; the commit-hash badge span and its CSS module class are removed. The brand row keeps its two replaceable slots, so a deployment that wants a build identifier registers `sidebar.brand.name` with its own content.

## Alternatives considered

**Keep the hash behind a tooltip on the mark.** Rejected because it preserves hidden build metadata nobody asked for while keeping the code path that formats it; removal is the smaller surface.

**Move the suffix into a configurable slot option.** Rejected because deployments already own this exact text through `sidebar.brand.name`; a second knob for the same pixel would have no current consumer.

## Verification

`packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` pins the bare-name fallback and asserts no revision text renders even when `DSH_CLIENT_COMMIT_HASH` is set; the assembled-shell snapshot carries only the bare label. Both package READMEs describe the fallback without the badge.

## Consequences

The brand row reads as product, not build output. The environment variable stays injected by the web build for its remaining consumers; only the sidebar stops displaying it.
