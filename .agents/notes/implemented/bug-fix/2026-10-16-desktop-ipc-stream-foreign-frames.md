# Agent Note: The desktop IPC carrier keeps another stream's frames out of a session journal

Status: implemented

English | [中文](2026-10-16-desktop-ipc-stream-foreign-frames.zh.md)

## Problem

The desktop application surfaced `gateway/internal: session event stream emitted an entry before its opening cursor`. That message is raised by `RemoteJournalStream.opening` (`packages/api/gateway/src/client/journal-stream.ts`), which rejects any generation whose first delivered item is not its opening cursor; the stream name comes from `SessionEventStream` (`packages/api/session-controller/src/client/transport.ts`). A normal Host cannot trigger it: `SessionHistory.follow` (`packages/api/session-controller/src/history.ts`) yields its snapshot before entering the live loop, and the transport tests pin the client-side rejection with synthetic frames only.

The cause was the desktop renderer's own stream carrier. Remote streams travel over Electron IPC (`apps/desktop/src/render/transport.ts`, `apps/desktop/src/main/ipc/transport.ts`): the host mints a `streamId` per logical stream, answers `dsh:stream:open` with it, and pushes nothing until the renderer claims that id on `dsh:stream:claim`. Every logical stream's items are broadcast on the shared `dsh:stream:frame` / `dsh:stream:end` channels, so each opener installs its own listener and filters by its own id — an id it learns only from the open reply, one round-trip after the listener attaches. The filter read `if (streamId !== undefined && frame.streamId !== streamId) return`: while this opener's id was still unknown, every frame of every OTHER stream already pumping on the bridge passed the filter and was buffered into this opener's inbox. Opening a session while another session streamed tokens therefore queued a foreign live `entry` ahead of this journal's own opening cursor, and the journal failed the whole stream. A foreign `end` frame had the same shape, setting `ended` before the id was known so the new stream completed at once.

The claim handshake existed to prevent exactly this and had no test that a concurrent stream cannot be mistaken for this one: `apps/desktop/tests/ipc-stream.spec.ts` only exercised frames that arrive after every involved opener already knew its id.

## Decision

`createIpcStreamOpen`'s enqueue guard drops any frame until this opener's own id is known (`streamId === undefined || frame.streamId !== streamId`), instead of buffering frames that may belong to another stream.

Dropping is safe because of the handshake already in place: the host's `startPump` runs only from `dsh:stream:claim`, and the renderer sends that claim after assigning the id from the open reply. No frame of this stream can therefore arrive before this opener can recognize it, and a frame carrying another id can never become this stream's item. The inbox still buffers this stream's own frames that arrive between the claim and the first `next()`, which is what it holds today.

`apps/desktop/tests/ipc-stream.spec.ts` pins both halves: one case broadcasts a foreign entry while the open reply is in flight and requires the stream's own opening frame, the second broadcasts a foreign end and requires the stream to keep running. Both fail against the previous guard (the first yields the foreign entry as the stream's first item, the second yields immediate completion).

## Alternatives considered

- **Route each stream on its own IPC channel (`dsh:stream:<id>:frame`).** Rejected as a larger change for the same guarantee: it rewrites the preload/main channel contract, so a renderer speaking it needs a shell that ships it, and the two halves of a desktop install must always match. The filter reaches the same isolation inside the protocol that already exists.
- **Mint the `streamId` in the renderer, as the browser WebSocket mux client does (`packages/api/gateway/src/client/stream-client.ts`).** Rejected: the pump and its abort registry live in the main process, so a renderer-minted id makes the host trust a caller-supplied correlation id and validate it against collisions before pumping. The host owns the id space it pushes into.
- **Make the journal client tolerate a pre-cursor entry and repair the window.** Rejected: a generation that delivers another stream's entry has already broken the carrier's own contract. Repairing it would silently accept the wrong bytes, and the protocol check is what made this bug visible at all.

## Consequences

- A session opened while another streams no longer fails with a protocol violation; the new spec cases fail without the fix, which is the evidence that this class of contamination is closed.
- The claim handshake is now load-bearing from both ends and tested from both ends: this spec pins that a broadcast frame of another stream is never adopted, and `apps/desktop/tests/transport.spec.ts` pins that the host pumps only after the claim.
- The same rule holds for any future carrier that broadcasts one channel to per-stream readers: a reader may only accept frames whose id it already owns, because a shared channel cannot tell it which pending stream a frame belongs to.
- The change is renderer-side in the desktop shell, so a packaged application carries it only in a new build: no profile or client-plugin hot-reload path reaches the render transport, unlike the web artifacts served from a profile. `apps/desktop/dist/render-transport.js` is rebuilt by `pnpm --filter @deepseek-ai/dsh-desktop build:render-transport`, which `scripts/dev.ts` already runs before launching.
- Related but not superseded: [the Session Controller wire-subscription disposal note](2026-09-21-session-controller-wire-subscription-disposal.md) records the per-stream listener count growing on re-activation. This fix changes which frames a listener accepts, not how many listeners exist; the `finally` block that unregisters them is unchanged.
