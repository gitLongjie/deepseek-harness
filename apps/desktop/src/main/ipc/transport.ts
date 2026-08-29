/**
 * Electron IPC carrier for the web transport. The renderer installs an
 * `__DSH_TRANSPORT__` hook pair (unary fetch plus Gateway stream opener), and
 * these handlers are their main-process halves: unary `/api` requests dispatch
 * through the Connection shared-channel handler exactly as the HTTP route
 * does, and Remote streams open through the Gateway wire stream with items
 * pushed as IPC frames.
 * @module @deepseek-ai/dsh-desktop/ipc/transport
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'

/**
 * The loopback authority synthetic requests carry: the shared-channel trust
 * fence binds every `/api` request on the Host header, and the IPC carrier
 * speaks for this process's own renderer, not a remote page.
 */
const LOOPBACK_AUTHORITY = 'http://127.0.0.1'

/** Host services the IPC carrier dispatches through. */
export interface TransportHostServices {
  /** The Typert Gateway, `undefined` before the host settles. */
  gateway: TypertGatewayService | undefined
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

/** Renderer request to open one Gateway Remote stream. */
export interface TransportStreamStart {
  /** The wire endpoint, e.g. `$events` or a `namespace/method` Remote. */
  endpoint: string
  /** The carrier payload; stream Remote calls carry `{ args }`. */
  payload: unknown
}

/**
 * Dispatch one unary IPC request through the host `/api` surface: the
 * Connection shared-channel handler, whose exact Fetch routes, Gateway
 * interceptor, and generic channels own every endpoint.
 * @param host - current host services; `connection: undefined` before the host settles.
 * @param req - the renderer's fetch-shaped request.
 * @param signal - abort routing for the request.
 * @returns the dispatched Fetch response; 503 before the host settles.
 */
export async function dispatchTransportFetch(
  host: TransportHostServices,
  req: TransportFetchRequest,
  signal: AbortSignal,
): Promise<Response> {
  const { connection } = host
  if (connection === undefined) return new Response('host not ready', { status: 503 })
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
  const handler = connection.createSharedFetchHandler('/api', connection.createChannelsFetchHandler({
    fetch: () => Promise.resolve(new Response('not found', { status: 404 })),
  }))
  return handler.fetch(new Request(new URL(req.path, LOOPBACK_AUTHORITY), init))
}

/**
 * Register the transport IPC handlers against a host-service accessor.
 * @param getHost - resolves the current host services; `connection: undefined` before the host settles.
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
  const openStream = (event: Electron.IpcMainInvokeEvent, opts: TransportStreamStart): string => {
    const { gateway } = getHost()
    if (gateway === undefined) throw new Error('desktop: host not ready for Remote streams')
    const streamId = randomUUID()
    const controller = new AbortController()
    streamAborts.set(streamId, controller)
    void (async () => {
      try {
        const items = await gateway.wireStream.open(opts.endpoint, opts.payload, controller.signal)
        for await (const item of items) {
          if (event.sender.isDestroyed()) break
          // One object argument: the preload bridge forwards a single payload
          // per frame, so the streamId must ride inside it.
          event.sender.send('dsh:stream:frame', { streamId, item })
        }
      } catch (error) {
        console.error(`desktop: stream ${opts.endpoint} error: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!event.sender.isDestroyed()) {
        event.sender.send('dsh:stream:end', { streamId })
      }
      streamAborts.delete(streamId)
    })()
    return streamId
  }
  ipcMain.handle('dsh:stream:open', (event, opts: TransportStreamStart): string => openStream(event, opts))
  ipcMain.on('dsh:stream:stop', (_event, streamId: string): void => {
    streamAborts.get(streamId)?.abort()
    streamAborts.delete(streamId)
  })

  return () => {
    for (const controller of aborts.values()) controller.abort()
    for (const controller of streamAborts.values()) controller.abort()
    aborts.clear()
    streamAborts.clear()
    ipcMain.removeHandler('dsh:transport:fetch')
    ipcMain.removeHandler('dsh:stream:open')
    ipcMain.removeAllListeners('dsh:transport:abort')
    ipcMain.removeAllListeners('dsh:stream:stop')
  }
}
