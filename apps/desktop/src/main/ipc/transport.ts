/**
 * Electron IPC carrier for the web transport. The renderer's ElectronApiClient
 * replaces the HTTP carrier; these handlers expose the host's `/api` surface as
 * a fetch-shaped pure function (the same isomorphic point as the InProcessApiClient)
 * and push the mux/host event streams as frames over IPC, bypassing HTTP and SSE.
 * Unary requests dispatch through the Connection shared-channel handler when the
 * service is mounted, so interceptor-claimed endpoints (the Typert gateway) ride
 * the same IPC path as the ApiProxy unary routes.
 * @module @deepseek-ai/dsh-desktop/ipc/transport
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  RpcId,
  toFetchHandler,
  type ApiProxy,
  type HostFrame,
  type MuxFrame,
  type RpcRequest,
} from '@deepseek-ai/dsh-host-apiproxy'

/**
 * The loopback authority synthetic requests carry: the shared-channel trust
 * fence binds every `/api` request on the Host header, and the IPC carrier
 * speaks for this process's own renderer, not a remote page.
 */
const LOOPBACK_AUTHORITY = 'http://127.0.0.1'

/** Host services the IPC carrier dispatches through. */
export interface TransportHostServices {
  /** The host ApiProxy; `undefined` before the host settles. */
  api: ApiProxy | undefined
  /** The Connection shared-channel registry, when the composition mounted it. */
  connection: HostConnectionHandle | undefined
}

/** A unary fetch request from the renderer. */
export interface TransportFetchRequest {
  /** Caller-owned correlation id for abort routing. */
  requestId: string
  /** URL pathname, e.g. `/api/session.create`. */
  path: string
  /** HTTP method. */
  method: string
  /** Request headers. */
  headers?: Record<string, string>
  /** JSON body text. */
  body?: string
}

/** The fetch response carried back to the renderer. */
export interface TransportFetchResponse {
  status: number
  /** The response body bytes. */
  body: number[]
  /** The response content-type, when present. */
  contentType?: string
}

/** Renderer request to open one downstream event stream. */
export interface TransportEventsStart {
  kind: 'mux' | 'host'
}

/**
 * Dispatch one unary IPC request through the host `/api` surface: the
 * Connection shared-channel handler when the service is mounted, else the bare
 * ApiProxy unary dispatcher.
 * @param host - current host services; `api: undefined` before the host settles.
 * @param req - the renderer's fetch-shaped request.
 * @param signal - abort routing for the request.
 * @returns the dispatched Fetch response; 503 before the host settles.
 */
export async function dispatchTransportFetch(
  host: TransportHostServices,
  req: TransportFetchRequest,
  signal: AbortSignal,
): Promise<Response> {
  const { api, connection } = host
  if (api === undefined) return new Response('host not ready', { status: 503 })
  const init: RequestInit = { method: req.method, signal }
  // The wire needs the JSON media type and a loopback Host for the shared
  // channel's trust fence; browser markers never exist on this seam, so
  // nothing else is forwarded from the renderer.
  const contentType = req.headers?.['content-type']
  init.headers = {
    host: new URL(LOOPBACK_AUTHORITY).host,
    ...(contentType === undefined ? {} : { 'content-type': contentType }),
  }
  if (req.body !== undefined) init.body = req.body
  const fallback = toFetchHandler(api)
  // Generic RPC channels (/weixin, …) have no /api interceptor; the channel
  // dispatcher reaches them, and /api endpoints still take the shared handler.
  const handler = connection === undefined
    ? fallback
    : connection.createSharedFetchHandler('/api', connection.createChannelsFetchHandler(fallback))
  return handler.fetch(new Request(new URL(req.path, LOOPBACK_AUTHORITY), init))
}

/**
 * Register the transport IPC handlers against a host-service accessor.
 * @param getHost - resolves the current host services; `api: undefined` before the host settles.
 * @returns a disposer that removes every handler and aborts live streams.
 */
export function registerTransportIpc(getHost: () => TransportHostServices): () => void {
  const aborts = new Map<string, AbortController>()

  ipcMain.handle('dsh:transport:fetch', async (_event, req: TransportFetchRequest): Promise<TransportFetchResponse> => {
    const controller = new AbortController()
    aborts.set(req.requestId, controller)
    try {
      const response = await dispatchTransportFetch(getHost(), req, controller.signal)
      const body = new Uint8Array(await response.arrayBuffer())
      const contentType = response.headers.get('content-type')
      return {
        status: response.status,
        body: Array.from(body),
        ...(contentType === null ? {} : { contentType }),
      }
    } finally {
      aborts.delete(req.requestId)
    }
  })
  ipcMain.on('dsh:transport:abort', (_event, requestId: string): void => {
    aborts.get(requestId)?.abort()
  })

  const streamAborts = new Map<string, AbortController>()
  const pushStream = (event: Electron.IpcMainInvokeEvent, opts: TransportEventsStart): string => {
    const api = getHost().api
    if (api === undefined) throw new Error('desktop: host not ready for event stream')
    const streamId = randomUUID()
    const controller = new AbortController()
    streamAborts.set(streamId, controller)
    const iter = opts.kind === 'mux'
      ? api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, controller.signal)
      : api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, controller.signal)
    void (async () => {
      let frameCount = 0
      try {
        for await (const frame of iter as AsyncIterable<RpcRequest<MuxFrame | HostFrame>>) {
          frameCount += 1
          if (frameCount <= 40) {
            const payload = frame.payload as { type?: string; event?: { type?: string } }
            const label = payload.type === 'session/event' ? `session/event:${payload.event?.type ?? '?'}` : (payload.type ?? '?')
            console.error(`desktop: ${opts.kind} frame #${frameCount} ${label} at ${Date.now()}`)
          }
          if (event.sender.isDestroyed()) break
          // One object argument: the preload bridge forwards a single payload
          // per frame, so the streamId must ride inside it.
          event.sender.send('dsh:events:frame', { streamId, frame })
        }
      } catch (error) {
        console.error(`desktop: ${opts.kind} stream error: ${error instanceof Error ? error.message : String(error)}`)
      }
      console.error(`desktop: ${opts.kind} stream ${streamId} ended after ${frameCount} frames`)
      if (!event.sender.isDestroyed()) {
        event.sender.send('dsh:events:end', { streamId })
      }
      streamAborts.delete(streamId)
    })()
    return streamId
  }
  ipcMain.handle('dsh:events:start', (event, opts: TransportEventsStart): { streamId: string } => {
    const streamId = pushStream(event, opts)
    console.error(`desktop: events start ${opts.kind} ${streamId} at ${Date.now()}`)
    return { streamId }
  })
  ipcMain.on('dsh:events:stop', (_event, streamId: string): void => {
    console.error(`desktop: events stop ${streamId} at ${Date.now()}`)
    streamAborts.get(streamId)?.abort()
    streamAborts.delete(streamId)
  })

  return () => {
    for (const controller of aborts.values()) controller.abort()
    for (const controller of streamAborts.values()) controller.abort()
    aborts.clear()
    streamAborts.clear()
    ipcMain.removeHandler('dsh:transport:fetch')
    ipcMain.removeHandler('dsh:events:start')
    ipcMain.removeAllListeners('dsh:transport:abort')
    ipcMain.removeAllListeners('dsh:events:stop')
  }
}
