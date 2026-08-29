/**
 * Render-side IPC transport halves for the `__DSH_TRANSPORT__` hooks: a
 * fetch-shaped unary caller over IPC and a Gateway Remote stream opener whose
 * validated items arrive as pushed IPC frames — no HTTP, no WebSocket.
 * @module @deepseek-ai/dsh-desktop/render/transport
 */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
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
  const requestId = randomUUID()
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

type StreamFrame = { streamId: string; item: unknown } | { streamId: string; kind: 'end' }

/**
 * The Gateway stream opener: one IPC stream per logical Remote stream, with
 * abort bridged to the host-side signal that cancels it.
 */
export function createIpcStreamOpen(ipc: IpcBridge): RpcStreamOpen {
  return (endpoint, payload, signal) => {
    // Frames may arrive before the open invoke's reply round-trips back, so
    // the listeners attach first and buffer until the streamId is known.
    const inbox: StreamFrame[] = []
    let streamId: string | undefined
    let wake: (() => void) | undefined
    let ended = false
    const enqueue = (frame: StreamFrame): void => {
      if (seen < 6) console.error(`desktop render: enqueue ${endpoint} mine=${String(streamId === undefined ? 'pending' : frame.streamId === streamId)} frameId=${frame.streamId.slice(0, 6)}`)
      if (streamId !== undefined && frame.streamId !== streamId) return
      if (frame.kind === 'end') ended = true
      inbox.push(frame)
      const w = wake
      wake = undefined
      w?.()
    }
    const offFrame = ipc.on('dsh:stream:frame', (data) => {
      const frame = data as { streamId: string; item: unknown }
      enqueue({ streamId: frame.streamId, item: frame.item })
    })
    const offEnd = ipc.on('dsh:stream:end', (data) => {
      enqueue({ streamId: (data as { streamId: string }).streamId, kind: 'end' })
    })
    const opened = ipc
      .invoke('dsh:stream:open', { endpoint, payload })
      .then(({ streamId: id }) => {
        streamId = id
        // Drop frames from any earlier stream that raced this open.
        for (let i = inbox.length - 1; i >= 0; i -= 1) {
          if (inbox[i].streamId !== id) inbox.splice(i, 1)
        }
        if (ended) ipc.send('dsh:stream:stop', id)
      })
      .catch((error: unknown) => {
        offFrame()
        offEnd()
        throw error
      })

    async function *iterate(): AsyncGenerator<unknown> {
      await opened
      try {
        while (true) {
          const frame = inbox.shift()
          if (frame === undefined) {
            if (ended) return
            await new Promise<void>((resolve) => { wake = resolve })
            continue
          }
          if (frame.kind === 'end') return
          yield frame.item
        }
      } finally {
        offFrame()
        offEnd()
        if (!ended && !signal.aborted) ipc.send('dsh:stream:stop', streamId)
      }
    }

    // The hooks contract wants a synchronous AsyncIterable; surface async
    // open failures through iteration instead.
    let iterator: AsyncGenerator<unknown> | undefined
    const seen = 0
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          iterator ??= iterate()
          return iterator.next()
        },
      }),
    }
  }
}
