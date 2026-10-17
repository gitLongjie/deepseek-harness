# Agent Note: the video workbench routes ride the Connection Fetch registry

Status: implemented

English | [中文](2026-10-07-video-workbench-connection-fetch-routes.zh.md)

## Problem

The video workbench page reported "无法加载视频工作台列表。" in the desktop application while the same route answered `200` with a full listing to any local HTTP client on the shell's own web-server port.

The host half registered both routes through `ctx.webServer.register` as `exact` routes. That table is consulted only by requests arriving on the web server's socket. The desktop renderer is not served from there: it loads `dshapp://localhost/index.html`, and its `/api/*` requests — whether issued by the renderer's `fetch` or by a media element's `src` — are dispatched by the app-scheme protocol handler through `dispatchTransportFetch` (`apps/desktop/src/main/index.ts`, `src/main/ipc/transport.ts`), which composes `connection.createSharedFetchHandler('/api', connection.createChannelsFetchHandler(...))`. That handler consults exactly three owners: exact Fetch routes registered on the Connection registry, the Typert Gateway interceptor, and generic RPC channels. `/api/video-workbench/projects` matched none, fell through to the channel fallback, and answered `404`; the page's loader rejected and rendered its failure line. The keyframe and final-assembly `<img>`/`<video>` URLs failed the same way, so a project's media could never load either.

Two properties made this invisible to the package's own tests: the routes were exercised through a hand-built web-server stub that recorded whatever was registered, and the desktop shell's own transport test stubs the shared handler. Nothing asserted which registry the plugin registered on.

## Decision

Both routes register on Connection's exact Fetch registry via `ctx.connection.fetch.register` under `ctx.effect`, and `inject` names the `connection` service instead of `webServer`. That registry is the documented carrier-neutral surface for a Host feature's exact route (`ConnectionFetchRoute`: "One exact, transport-independent Fetch route owned by a Host feature"), and it is the one the browser's `/api` prefix route and the desktop shell's in-process transport both dispatch through — the same choice `/api/file` (session-controller) and `/api/present.host` (ui-deliverables) already make.

The handlers became Fetch-shaped: `writeWorkbenchFile(resolved, head, res)` (node:http `ServerResponse`) is now `workbenchFileResponse(resolved, method): Response`, streaming the admitted file through `Readable.toWeb(createReadStream(path))`. The read-only routes no longer answer `405` for an unowned method; the registry forwards those to normal shared-channel dispatch, exactly as `/api/file` does.

Two adjacent corrections in the same file: the unused `readWorkbenchText` export (no caller, and its JSDoc claimed a caller that did not exist) is gone, and the plugin no longer default-exports `{ name, inject, Config, apply }` — the namespace form is the only one the cordis Loader keeps ([postmortem 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Alternatives considered

- **Keep the web-server routes and teach the desktop shell to proxy this prefix.** Rejected: `proxyToWebHost` exists only for the `/open-in-app/` prefix because those routes must live on the loopback listener; a per-prefix allowlist in the shell for a plugin that has a carrier-neutral registry duplicates the dispatch and re-derives the browser cookie handshake for a route the in-process transport already reaches.
- **Register on both surfaces.** Rejected: two implementations of one route, with the web-server row shadowing the registry row (`WebServer.match` prefers the exact table), so the browser would silently keep the unauthenticated path while tests exercised the other.
- **Serve the media through a Remote instead of a route.** Rejected on the same grounds as the feature note: a whole mp4 through a JSON Remote is whole-file base64, and an element `src` cannot call a Remote.

## Consequences

- The listing, keyframe thumbnails, and the final `<video>` load in the desktop application as well as in a browser. Verified by mounting the real plugin beside a real `HostConnectionService` and dispatching through the desktop's own composition (`tests/transport.spec.ts`): listing `200`, media `200` with `video/mp4` and the full byte length, escape `403`.
- Requests now pass Connection's Host/Origin fence and browser authentication before reaching either route. Previously the web-server rows bypassed both, so any local process — or a rebound page — could read the projected directory. A browser without the shell's auth cookie now receives `401` where it previously received the listing.
- The package depends on `@deepseek-ai/dsh-client-connection` (type-only, devDependency for the `ctx.connection` merge) and its tsconfig references `packages/client/connection/tsconfig.host.json` instead of `packages/host/webserver`. A profile that mounts the workbench without Connection leaves it PENDING rather than serving routes nothing can reach.
- `packages/video/video-workbench` is not at the per-file 100% coverage gate: `src/projects.ts` and two unreachable defensive arms in `src/file-serve.ts` (`?? ''` on a non-empty segment list, `distance === ''`) predate this change. This fix leaves them as they were and they still need their own pass.
