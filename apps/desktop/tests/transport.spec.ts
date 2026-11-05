/** Unary IPC dispatch through the Connection shared-channel handler. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() },
}))

import { ipcMain } from 'electron'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { createIpcFetch } from '../src/render/transport.ts'
import { dispatchTransportFetch, registerTransportIpc, transportRequestBytes } from '../src/main/ipc/transport.ts'

/** The never-settled host: no Connection yet. */
const UNSETTLED = { gateway: undefined, connection: undefined }

/** Bytes no UTF-8 decode round-trips: a PNG header plus an invalid continuation byte. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe])

describe('dispatchTransportFetch', () => {
  it('answers 503 before the host settles', async () => {
    const response = await dispatchTransportFetch(UNSETTLED, {
      requestId: 'r', path: '/api/settings.describe', method: 'POST',
    }, new AbortController().signal)
    expect(response.status).toBe(503)
  })

  it('routes interceptor-claimed endpoints through the Connection shared-channel handler', async () => {
    let seen: Request | undefined
    const connection = {
      createSharedFetchHandler: () => ({
        fetch: async (request: Request) => {
          seen = request
          return new Response('gateway', { status: 200 })
        },
      }),
      createChannelsFetchHandler: () => ({
        fetch: async () => new Response('unreachable', { status: 500 }),
      }),
    } as unknown as HostConnectionHandle
    const response = await dispatchTransportFetch(
      { gateway: {} as never, connection },
      {
        requestId: 'r',
        path: '/api/dynamicCordisRunner/inventory',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"rpcId":"r1"}',
      },
      new AbortController().signal,
    )
    expect(await response.text()).toBe('gateway')
    // The synthetic request carries the loopback Host the shared channel's
    // trust fence binds on, plus the JSON media type the envelope needs.
    expect(seen?.url).toBe('http://127.0.0.1/api/dynamicCordisRunner/inventory')
    expect(seen?.headers.get('host')).toBe('127.0.0.1')
    expect(seen?.headers.get('content-type')).toBe('application/json')
  })

  it('forwards a media range header to the shared-channel handler', async () => {
    let seen: Request | undefined
    const connection = {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch(request: Request): Promise<Response> }) => fallback,
      createChannelsFetchHandler: () => ({
        fetch: async (request: Request) => {
          seen = request
          return new Response('range', { status: 206 })
        },
      }),
    } as unknown as HostConnectionHandle
    const response = await dispatchTransportFetch(
      { gateway: {} as never, connection },
      {
        requestId: 'r',
        path: '/api/video-workbench/file?path=final%2Fvp-1.mp4',
        method: 'GET',
        headers: { range: 'bytes=0-99' },
      },
      new AbortController().signal,
    )
    expect(response.status).toBe(206)
    expect(seen?.headers.get('range')).toBe('bytes=0-99')
  })

  it('routes a generic RPC channel through the Connection channel dispatcher', async () => {
    let seen: Request | undefined
    const connection = {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch(request: Request): Promise<Response> }) => fallback,
      createChannelsFetchHandler: (fallback: unknown) => ({
        fetch: async (request: Request) => {
          seen = request
          void fallback
          return new Response('channel', { status: 200 })
        },
      }),
    } as unknown as HostConnectionHandle
    const response = await dispatchTransportFetch(
      { gateway: {} as never, connection },
      {
        requestId: 'r',
        path: '/weixin/connection.status',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"type":"client-request","rpcId":"r1","method":"connection.status","payload":{}}',
      },
      new AbortController().signal,
    )
    expect(await response.text()).toBe('channel')
    expect(seen?.url).toBe('http://127.0.0.1/weixin/connection.status')
  })

  it('answers 404 for endpoints no shared-channel owner claims', async () => {
    const connection = {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch(request: Request): Promise<Response> }) => fallback,
      createChannelsFetchHandler: () => ({
        fetch: async () => new Response('not found', { status: 404 }),
      }),
    } as unknown as HostConnectionHandle
    const response = await dispatchTransportFetch(
      { gateway: {} as never, connection: connection as HostConnectionHandle },
      {
        requestId: 'r',
        path: '/api/no.such.method',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"rpcId":"r1"}',
      },
      new AbortController().signal,
    )
    expect(response.status).toBe(404)
  })

  it('hands a binary request body to the handler byte for byte', async () => {
    let seen: Request | undefined
    const connection = {
      createSharedFetchHandler: () => ({
        fetch: async (request: Request) => {
          seen = request
          return new Response('stored', { status: 200 })
        },
      }),
      createChannelsFetchHandler: () => ({
        fetch: async () => new Response('unreachable', { status: 500 }),
      }),
    } as unknown as HostConnectionHandle
    await dispatchTransportFetch(
      { gateway: {} as never, connection },
      {
        requestId: 'r',
        path: '/api/session/uploadFileBinary?sessionId=s&mediaType=image%2Fpng',
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: PNG_BYTES,
      },
      new AbortController().signal,
    )
    // A pasted image reaches the Host unchanged; a text decode would replace
    // the invalid UTF-8 bytes and admission would refuse the raster.
    expect(new Uint8Array(await seen!.arrayBuffer())).toEqual(PNG_BYTES)
  })
})

describe('transportRequestBytes', () => {
  it('reads an app-scheme body as the exact bytes the renderer sent', async () => {
    const request = new Request('https://desktop.invalid/api/session/uploadFileBinary?sessionId=s', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: PNG_BYTES,
    })
    expect(await transportRequestBytes(request)).toEqual(PNG_BYTES)
  })

  it('reports no body for a bodyless method', async () => {
    const request = new Request('https://desktop.invalid/api/session/list', { method: 'GET' })
    expect(await transportRequestBytes(request)).toBeUndefined()
  })
})

describe('registerTransportIpc stream handshake', () => {
  it('waits for a Gateway remount instead of rejecting a stream opened during host reload', async () => {
    const gateway = {
      wireStream: {
        open: async (): Promise<AsyncIterable<unknown>> => (async function* () {})(),
      },
    } as never
    type PublishedGateway = typeof gateway
    let currentGateway: PublishedGateway | undefined
    let publishGateway: ((next: PublishedGateway) => void) | undefined
    const remove = registerTransportIpc(
      () => ({ gateway: currentGateway, connection: undefined }),
      () => new Promise((resolve) => { publishGateway = resolve }),
    )
    try {
      const handle = (ipcMain.handle as unknown as {
        mock: { calls: Array<[string, (event: unknown, req: unknown) => unknown]> }
      }).mock.calls
      const openHandler = handle.findLast(([channel]) => channel === 'dsh:stream:open')?.[1]
      expect(openHandler).toBeTypeOf('function')
      const sender = { isDestroyed: () => false, send: () => {} }
      const opening = Promise.resolve().then(() => openHandler!({ sender }, { endpoint: '$events', payload: { args: {} } }))
      let settled = false
      void opening.then(() => { settled = true }, () => { settled = true })

      // Hold the invocation at the service-unavailable point, then publish the
      // replacement Gateway as a live profile reload would.
      await Promise.resolve()
      expect(settled).toBe(false)
      currentGateway = gateway
      publishGateway?.(gateway)

      await expect(opening).resolves.toMatchObject({ streamId: expect.any(String) })
    } finally {
      await remove()
    }
  })

  it('answers the open request with { streamId } and pumps only after the claim', async () => {
    const opened: Array<{ endpoint: string; payload: unknown; signal: AbortSignal }> = []
    const gateway = {
      wireStream: {
        open: (endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> => {
          opened.push({ endpoint, payload, signal })
          return Promise.resolve((async function* () { yield { type: 'ready' } })())
        },
      },
    } as never
    let send: ((channel: string, payload: unknown) => void) | undefined
    const remove = registerTransportIpc(() => ({ gateway, connection: undefined }))
    try {
      const handle = (ipcMain.handle as unknown as {
        mock: { calls: Array<[string, (event: unknown, req: unknown) => unknown]> }
      }).mock.calls
      const on = (ipcMain.on as unknown as {
        mock: { calls: Array<[string, (event: unknown, payload: unknown) => void]> }
      }).mock.calls
      const openHandler = handle.findLast(([channel]) => channel === 'dsh:stream:open')?.[1]
      const claimHandler = on.findLast(([channel]) => channel === 'dsh:stream:claim')?.[1]
      expect(openHandler).toBeTypeOf('function')
      expect(claimHandler).toBeTypeOf('function')
      const sender = { isDestroyed: () => false, send: (channel: string, payload: unknown): void => { send?.(channel, payload) } }
      send = vi.fn()
      const response = await openHandler!({ sender }, { endpoint: '$events', payload: { args: {} } }) as { streamId?: string }
      // The claim contract: an object field, not a bare string.
      expect(typeof response).toBe('object')
      expect(typeof response.streamId).toBe('string')
      expect(opened).toHaveLength(0)
      claimHandler!({}, response.streamId)
      await vi.waitFor(() => { expect(opened).toHaveLength(1) })
      expect(opened[0]!.endpoint).toBe('$events')
    } finally {
      await remove()
    }
  })
})

describe('createIpcFetch', () => {
  it('resolves the document-relative RPC route against the document base', async () => {
    vi.stubGlobal('document', { baseURI: 'dshapp://localhost/index.html' })
    const seen: { path: string }[] = []
    const ipc = {
      platform: 'win32',
      invoke: async (_channel: string, payload: { path: string }) => {
        seen.push(payload)
        return { status: 200, body: [] as number[] }
      },
      send: () => {},
      on: () => () => {},
    }
    const send = createIpcFetch(ipc)
    // The gateway RPC caller hands over the document-relative route the web
    // app's fetch would resolve itself; an unparsed relative URL here was the
    // upstream-merge regression that failed every desktop gateway call.
    const response = await send('api/dynamicCordisRunner/inventory', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(seen[0]?.path).toBe('/api/dynamicCordisRunner/inventory')
    vi.unstubAllGlobals()
  })

  it('forwards a binary body as exact bytes instead of dropping it', async () => {
    vi.stubGlobal('document', { baseURI: 'dshapp://localhost/index.html' })
    const seen: { body?: string | Uint8Array }[] = []
    const ipc = {
      platform: 'win32',
      invoke: async (_channel: string, payload: { body?: string | Uint8Array }) => {
        seen.push(payload)
        return { status: 200, body: [] as number[] }
      },
      send: () => {},
      on: () => () => {},
    }
    await createIpcFetch(ipc)('api/session/uploadFileBinary?sessionId=s', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([PNG_BYTES]),
    })
    expect(seen[0]?.body).toEqual(PNG_BYTES)
    vi.unstubAllGlobals()
  })

  it('refuses a body kind the IPC carrier cannot forward instead of sending an empty one', async () => {
    vi.stubGlobal('document', { baseURI: 'dshapp://localhost/index.html' })
    const invoke = vi.fn()
    const ipc = { platform: 'win32', invoke, send: () => {}, on: () => () => {} }
    await expect(createIpcFetch(ipc)('api/session/list', {
      method: 'POST',
      body: new ReadableStream(),
    })).rejects.toThrow('only text, byte, and Blob bodies cross the IPC carrier')
    expect(invoke).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
