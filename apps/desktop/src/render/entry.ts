/**
 * Render-side transport bootstrap. Injected as the first head script, this IIFE
 * installs `window.__DSH_TRANSPORT__` before the Vite shell runs, so
 * `AppWebEntry` picks up the IPC carrier instead of the HTTP one.
 * @module @deepseek-ai/dsh-desktop/render/entry
 */

import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection'
import { createIpcFetch, ElectronApiClient, type IpcBridge } from './transport.ts'
import { installTitleBar } from './title-bar.ts'

declare global {
  interface Window {
    __DSH_TRANSPORT__?: ClientTransportHooks
    __DSH_IPC__?: IpcBridge
  }
}

const ipc = window.__DSH_IPC__
if (ipc === undefined) {
  throw new Error('desktop render: preload bridge __DSH_IPC__ is missing')
}

// The title bar defers its body mount internally (this IIFE runs as a head
// script); the transport below must stay synchronous — AppWebEntry reads it
// during boot.
installTitleBar(document, ipc, './favicon.ico')

const client = new ElectronApiClient(ipc)

const transport: ClientTransportHooks = {
  createApiClient: () => client,
  fetch: (input: URL, init: RequestInit) => createIpcFetch(ipc)(input, init),
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
}
// oxlint-disable-next-line typescript/no-unsafe-assignment -- Window augmentation invisible to oxlint's type-aware pass.
window.__DSH_TRANSPORT__ = transport
