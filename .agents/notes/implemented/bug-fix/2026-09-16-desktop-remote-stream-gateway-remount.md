# Agent Note: Wait for desktop Gateway remounts before opening Remote streams

Status: implemented

English | [中文](2026-09-16-desktop-remote-stream-gateway-remount.zh.md)

## Problem

The Electron renderer can open a Typert Remote stream while a live desktop profile reload has temporarily withdrawn `typertGateway`. Rejecting that IPC call makes the renderer report a lost connection and start its retry loop even though the Host is still recovering normally.

## Decision

`apps/desktop/src/main/ipc/transport.ts` accepts a Gateway waiter for Remote stream opens. When the current Host has no Gateway, the open handler remains pending until the desktop entry observes the next `typertGateway` `internal/service` publication. The resulting Gateway is retained with the unclaimed stream and pumps it after the renderer claims its ID, so a second service change cannot redirect that stream to another provider.

## Alternatives considered

**Renderer retry.** The existing retry treats a normal Host service remount as a transport failure, creates visible warnings, and adds repeated connection work; the Host owns service availability and can wait on its authoritative publication event.

**Fixed startup delay.** A delay neither observes the service state nor covers later profile reloads, so it can still fail under slow activation and unnecessarily delays a ready Host.

## Consequences

Remote stream creation waits during the narrow Gateway-unavailable interval instead of rejecting to the renderer. A permanently failed Host can leave the request pending until Electron shuts down; application shutdown owns that process lifetime. The desktop transport test uses a controlled Gateway publication to verify that an open begun during the absence resolves only after the replacement is published.
