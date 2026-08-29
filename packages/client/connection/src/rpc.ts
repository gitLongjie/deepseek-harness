/** Generic unary RPC contracts shared by the Host and Client Connection halves. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Trust fence applied before a Host RPC channel reaches its handler. */
export type ConnectionRpcAuthority = 'trusted-host' | 'loopback'

/** Registration policy for one logical RPC channel. */
export interface ConnectionRpcHandlerOptions {
  /** Browser authority accepted by every endpoint in this channel. */
  readonly authority: ConnectionRpcAuthority
}

/** Handler invoked after Connection has decoded the transport envelope. */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
  /**
   * Register one absolute channel prefix and its trust policy.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - channel trust policy.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - trust policy for every endpoint claimed by this interceptor.
   * @returns asynchronous disposer removing the interceptor.
   */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>
}

/** Transport-independent request handler a shared-channel dispatch selects. */
export interface ConnectionFetchHandler {
  /**
   * Handle one standard Fetch request.
   * @param request - request produced by the active transport carrier.
   * @returns complete or streaming Fetch response.
   */
  fetch(request: Request): Promise<Response>
}

/** Host `ctx.connection` shape consumed by transport-independent adapters. */
export interface HostConnectionHandle {
  /** Generic RPC channel registry. */
  readonly rpc: HostConnectionRpc

  /**
   * Compose one shared-channel Fetch handler from its interceptor and fallback,
   * so an in-process carrier (the desktop IPC transport) reaches
   * interceptor-claimed endpoints — the Typert gateway — exactly as the HTTP
   * route does.
   * @param channel - shared channel mounted by Connection.
   * @param fallback - handler for endpoints the interceptor does not claim.
   * @returns Fetch handler that selects exactly one target for each request.
   */
  createSharedFetchHandler(channel: '/api', fallback: ConnectionFetchHandler): ConnectionFetchHandler

  /**
   * Compose one channel-dispatch Fetch handler covering every generic channel
   * registered through `handle`, so an in-process carrier (the desktop IPC
   * transport) reaches them without the HTTP route table. Paths no registered
   * channel claims fall through to `fallback`.
   * @param fallback - handler for paths no registered channel claims.
   * @returns Fetch handler that selects exactly one target for each request.
   */
  createChannelsFetchHandler(fallback: ConnectionFetchHandler): ConnectionFetchHandler
}

/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the existing RPC success/error result; correlation stays inside Connection.
   */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}
