/**
 * Renderer-side Electron IPC transport. The page-world IIFE builds this
 * client over the preload bridge: unary calls post through IPC to the host's
 * ApiProxy (the isomorphic point the InProcessApiClient shares), and the
 * mux/host event streams consume frames the main process pushes — no HTTP, no
 * SSE.
 * @module @deepseek-ai/dsh-desktop/render/transport
 */

import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy'

/** The preload bridge surface, exposed as `window.__DSH_IPC__`. */
export interface IpcBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  send(channel: string, payload?: unknown): void
  on(channel: string, listener: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    __DSH_IPC__?: IpcBridge
  }
}

/** Normalize any HeadersInit to a plain record for IPC. */
function headersToRecord(headers?: HeadersInit): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((value, key) => { out[key] = value })
    return out
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

/** One unary fetch through the IPC bridge. */
async function ipcFetch(ipc: IpcBridge, input: URL, init?: RequestInit): Promise<Response> {
  const requestId = crypto.randomUUID()
  const body = init?.body
  const signal = init?.signal
  if (signal !== undefined && !signal.aborted) {
    signal.addEventListener('abort', () => { ipc.send('dsh:transport:abort', requestId) }, { once: true })
  }
  const res = await ipc.invoke('dsh:transport:fetch', {
    requestId,
    path: input.pathname,
    method: init?.method ?? 'GET',
    headers: headersToRecord(init?.headers),
    body: typeof body === 'string' ? body : undefined,
  }) as { status: number; body: number[]; contentType?: string }
  return new Response(new Uint8Array(res.body), {
    status: res.status,
    headers: res.contentType === undefined ? undefined : { 'content-type': res.contentType },
  })
}

/** A fetch-shaped IPC caller for the generic RPC channels (Typert gateway). */
export function createIpcFetch(ipc: IpcBridge): (input: URL, init: RequestInit) => Promise<Response> {
  return (input, init) => ipcFetch(ipc, input, init)
}

/** The renderer ApiClient: unary over IPC fetch, streams over pushed IPC frames. */
export class ElectronApiClient extends AbstractApiClient {
  constructor(private readonly ipc: IpcBridge) {
    super()
  }

  protected override doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return ipcFetch(this.ipc, input, init)
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readIpcStream<MuxFrame>('mux', signal, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readIpcStream<HostFrame>('host', signal, onOpen)
  }

  private async *readIpcStream<F extends MuxFrame | HostFrame>(
    kind: 'mux' | 'host',
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const { streamId } = await this.ipc.invoke('dsh:events:start', { kind }) as { streamId: string }
    onOpen?.()
    const inbox: Array<RpcRequest<F> | { kind: 'end' }> = []
    let wake: (() => void) | undefined
    const enqueue = (item: RpcRequest<F> | { kind: 'end' }): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const offFrame = this.ipc.on('dsh:events:frame', (payload) => {
      const data = payload as { streamId: string; frame: RpcRequest<F> }
      if (data.streamId !== streamId) return
      enqueue(data.frame)
    })
    const offEnd = this.ipc.on('dsh:events:end', (payload) => {
      const data = payload as { streamId: string }
      if (data.streamId !== streamId) return
      enqueue({ kind: 'end' })
    })
    const handleAbort = (): void => { enqueue({ kind: 'end' }) }
    signal.addEventListener('abort', handleAbort, { once: true })
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as RpcRequest<F> | { kind: 'end' }
          if (item.kind === 'end') return
          yield item
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      offFrame()
      offEnd()
      void this.ipc.invoke('dsh:events:stop', { streamId })
    }
  }
}
