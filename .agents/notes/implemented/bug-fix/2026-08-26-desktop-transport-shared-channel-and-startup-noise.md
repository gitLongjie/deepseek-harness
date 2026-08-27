# Agent Note: Desktop IPC dispatch through the Connection shared channel

Status: implemented

English | [中文](2026-08-26-desktop-transport-shared-channel-and-startup-noise.zh.md)

## Problem

The Electron shell carried renderer RPC over an IPC fetch handler that called the ApiProxy unary dispatcher directly, bypassing the `/api` interceptor chain. Every Typert-gateway endpoint the renderer called (`dynamicCordisRunner/inventory`, `syncInspectManifest`) therefore answered HTTP 404 even though `cordis-host-runner` was mounted. Separately, the desktop booted the web profile's `client-hmr` browser row, whose EventSource opens the dev-webserver-only `/plugins/events` SSE route; under the `dshapp://` file protocol that request became an ENOENT file read. Finally, a settings editor card held the revision it mounted with, so any pushed settings write under an open card made the next Apply fail with `settings-conflict` until the card was reopened.

## Decision

The desktop IPC unary dispatch goes through `ctx.connection.createSharedFetchHandler('/api', fallback)`, the same composition the HTTP route uses, so interceptor-claimed endpoints and the ApiProxy unary routes ride one path. `createSharedFetchHandler` moved onto the `HostConnectionHandle` interface (with a structural `ConnectionFetchHandler`) so an in-process carrier can consume it without the concrete service class. The synthetic Request carries a loopback Host header and only the JSON media type from the renderer; the shared channel's trust fence then binds it as this process's own traffic. The desktop overlay disables the `client-hmr` row because the file protocol has no SSE route. The provider editor card, on `settings-conflict`, re-describes the namespaces once and replays its path ops against the fresh revision; the ops name only fields the card observed, so the replay rebases the edit rather than overwriting another writer's fields. A conflict that survives the rebase is still reported as before, and the create card keeps its refusal semantics.

## Alternatives considered

**Expose the Typert gateway endpoints through the ApiProxy unary route table.** Rejected because the gateway is an interceptor on the shared `/api` channel by design; duplicating its claims in a second dispatch table would let the two drift.

**Point the renderer at the ephemeral loopback webserver.** Rejected because the desktop deliberately renders over the custom scheme with IPC as its only carrier; adding an HTTP dependency for two endpoints reopens the trust-fence surface the scheme avoids.

**Retry the settings write with `expectedRevision` omitted.** Rejected because a blind last-write-wins retry discards the compare-and-swap the revision exists for; replaying observed path ops against a freshly read revision keeps the guarantee for every field the card did not see.

**Gate the client-hmr EventSource on transport inside the plugin.** Rejected because the desktop composition, not the plugin, knows that no SSE route exists; an overlay disable states that locally where the web profile states its own.

## Verification

`apps/desktop/tests/transport.spec.ts` covers 503 before the host settles, interceptor-claimed dispatch with the loopback Host and forwarded media type, and fallback dispatch without the Connection service. The ui-settings-models component tests cover the one-shot rebase onto a fresh revision and the persistent-conflict refusal.

## Consequences

The desktop renderer reaches Typert-gateway endpoints over IPC, the startup log no longer carries the SSE ENOENT, and an open provider editor survives pushed settings writes. The desktop now depends on `@deepseek-ai/dsh-client-connection` for the handle type. Desktop dev iteration no longer gets client-plugin hot reload unless a later overlay re-enables the row behind a real SSE carrier.
