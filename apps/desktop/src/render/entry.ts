/**
 * Render-side transport bootstrap. Injected as the first head script, this IIFE
 * installs `window.__DSH_TRANSPORT__` before the Vite shell runs, so
 * `AppWebEntry` picks up the IPC carrier instead of the HTTP one.
 * @module @deepseek-ai/dsh-desktop/render/entry
 */

import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection'
import { createIpcFetch, createIpcStreamOpen, type IpcBridge } from './transport.ts'
import { installTitleBar } from './title-bar.ts'
import { installUpdateBadge } from './update-badge.ts'

declare global {
  interface Window {
    __DSH_TRANSPORT__?: ClientTransportHooks
    __DSH_IPC__?: IpcBridge
    __DSH_OPEN_SESSION__?: (sessionId: string) => void
  }
}

const ipc = window.__DSH_IPC__
if (ipc === undefined) {
  throw new Error('desktop render: preload bridge __DSH_IPC__ is missing')
}

ipc.on('dsh:notification:open-session', (payload) => {
  if (typeof payload === 'string') window.__DSH_OPEN_SESSION__?.(payload)
})

// The title bar defers its body mount and favicon lookup internally because
// this script runs before the remaining head markup is parsed. The transport
// below must stay synchronous — AppWebEntry reads it during boot.
installTitleBar(document, ipc, () => {
  const brandIcon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href')
  if (brandIcon === null || brandIcon === undefined) {
    throw new Error('desktop render: OEM favicon link is missing')
  }
  return brandIcon
})
installUpdateBadge(document, ipc)

const transport: ClientTransportHooks = {
  fetch: (input: URL, init: RequestInit) => createIpcFetch(ipc)(input, init),
  openStream: createIpcStreamOpen(ipc),
  loadBundle: async (url: string) => {
    const bytes = await ipc.invoke('dsh:transport:loadBundle', { url }) as number[] | undefined
    if (bytes === undefined) {
      throw new Error(`desktop render: no bundle bytes for ${url}`)
    }
    const source = new TextDecoder().decode(new Uint8Array(bytes))
    // Indirect eval runs the factory in global scope, where it registers itself
    // through window.__ModuleLoader__.load — the same contract the served
    // `<script src=/plugins/...>` form exercises.
    ;(0, eval)(source)
  },
  // The renderer speaks for this process's own host: the loopback stand-in
  // for "the operator's own machine" is vacuous here.
  ownsHost: true,
}
window.__DSH_TRANSPORT__ = transport
