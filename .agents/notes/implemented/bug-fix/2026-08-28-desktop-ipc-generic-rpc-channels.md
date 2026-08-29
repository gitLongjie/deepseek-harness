# Agent Note: Desktop IPC dispatch reaches generic RPC channels

Status: implemented

English | [中文](2026-08-28-desktop-ipc-generic-rpc-channels.zh.md)

## Problem

The desktop IPC fetch bridge dispatched every renderer request through `ctx.connection.createSharedFetchHandler('/api', fallback)`. That handler only recognizes endpoints under the shared `/api` channel; any request whose first path segment is a dedicated channel registered through `connection.rpc.handle` — for example `/weixin/connection.status` from the dsh-im settings page — fell through to the bare ApiProxy unary dispatcher, which does not know the channel, and answered HTTP 404. The same call succeeds in the served web app because `handle` registers one HTTP prefix route per channel on the real webserver, a route table the in-process desktop carrier never consults.

## Decision

`HostConnectionService` now records every `rpc.handle` registration in a channel map alongside its HTTP route, and exposes `createChannelsFetchHandler(fallback)` on `HostConnectionHandle`: a Fetch handler that resolves the first path segment against the registered channels, applies the same trust fence as the HTTP route (loopback channels check with no extra authorities, trusted-host channels with the deployment's `trustedHosts`), and falls back for unclaimed paths. The desktop IPC dispatcher composes `createSharedFetchHandler('/api', createChannelsFetchHandler(fallback))`, so `/api` endpoints keep taking the interceptor chain and generic channels take the dispatcher, both over the same synthetic loopback Request as before.

## Alternatives considered

**Teach the desktop renderer to prefix generic channels with `/api`.** Rejected because the client RPC caller is transport-independent and the web server routes channels at the root; rewriting paths per carrier would fork the wire contract the served app and plugins already code against.

**Mount the desktop's ephemeral webserver port into the renderer.** Rejected because the desktop deliberately keeps IPC as its only carrier; adding an HTTP dependency reopens the trust surface the custom scheme avoids.

**Route generic channels through the ApiProxy unary dispatcher.** Rejected because the dispatcher serves the Typert gateway's method table, not `rpc.handle` channels; teaching it the channel registry would duplicate dispatch in two services.

## Verification

`packages/client/connection/tests/node-half.host.spec.ts` covers channel dispatch with a 200 envelope, the 403 trust rejection for an untrusted Host, fallback for a `/api` path, and route withdrawal after dispose. `apps/desktop/tests/transport.spec.ts` covers the composed dispatch reaching `/weixin/connection.status` and keeps the interceptor-claimed `/api` case.

## Consequences

Plugins that register dedicated RPC channels (dsh-im's per-channel management RPC) work unchanged inside the desktop shell. Generic-channel trust now binds identically across the HTTP route and the IPC carrier because both consult the same fence; the channel map lifecycle mirrors the route registration disposal, so a disposed channel stops answering over both carriers in the same tick.
