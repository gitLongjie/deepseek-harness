/**
 * Render-side IPC transport halves for the `__DSH_TRANSPORT__` hooks: a
 * fetch-shaped unary caller over IPC and a Gateway Remote stream opener whose
 * validated items arrive as pushed IPC frames — no HTTP, no WebSocket.
 * @module @deepseek-ai/dsh-desktop/render/transport
 */

import { randomUuid } from '@deepseek-ai/dsh-util-crypto'
import type { RpcStreamOpen } from '@deepseek-ai/dsh-client-connection'

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
async function ipcFetch(ipc: IpcBridge, input: URL, init: RequestInit): Promise<Response> {
  const requestId = randomUuid()
  const signal = init.signal
  if (signal !== undefined && !signal.aborted) {
    signal.addEventListener('abort', () => { ipc.send('dsh:transport:abort', requestId) }, { once: true })
  }
  const res = await ipc.invoke('dsh:transport:fetch', {
    requestId,
    path: `${input.pathname}${input.search}`,
    method: init.method ?? 'GET',
    headers: headersToRecord(init.headers),
    body: typeof init.body === 'string' ? init.body : undefined,
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

/**
 * The Gateway stream opener: one IPC stream per logical Remote stream, with
 * abort bridged to the host-side signal that cancels it.
 */
export function createIpcStreamOpen(ipc: IpcBridge): RpcStreamOpen {
  return (endpoint, payload, signal) => {
    const opened = (async (): Promise<AsyncIterable<unknown>> => {
      const { streamId } = await ipc.invoke('dsh:stream:open', { endpoint, payload }) as { streamId: string }
      const inbox: Array<{ item: unknown } | { kind: 'end' }> = []
      let wake: (() => void) | undefined
      const enqueue = (item: { item: unknown } | { kind: 'end' }): void => {
        inbox.push(item)
        wake?.()
        wake = undefined
      }
      const offFrame = ipc.on('dsh:stream:frame', (data) => {
        const frame = data as { streamId: string; item: unknown }
        if (frame.streamId !== streamId) return
        enqueue({ item: frame.item })
      })
      const offEnd = ipc.on('dsh:stream:end', (data) => {
        const frame = data as { streamId: string }
        if (frame.streamId !== streamId) return
        enqueue({ kind: 'end' })
      })
      const handleAbort = (): void => {
        enqueue({ kind: 'end' })
        ipc.send('dsh:stream:stop', streamId)
      }
      signal.addEventListener('abort', handleAbort, { once: true })
      return (async function* (): AsyncGenerator<unknown> {
        try {
          while (true) {
            while (inbox.length > 0) {
              const next = inbox.shift() as { item: unknown } | { kind: 'end' }
              if (next.kind === 'end') return
              yield next.item
            }
            await new Promise<void>((resolve) => { wake = resolve })
          }
        } finally {
          signal.removeEventListener('abort', handleAbort)
          offFrame()
          offEnd()
          ipc.send('dsh:stream:stop', streamId)
        }
      })()
    })()
    // The hooks contract wants a synchronous AsyncIterable; surface async open
    // failures through iteration instead.
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => opened.then(iterator => iterator.next()),
      }),
    }
  }
}
