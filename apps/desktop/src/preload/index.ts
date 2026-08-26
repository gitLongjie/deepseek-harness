/**
 * Preload bridge: exposes low-level IPC primitives to the isolated renderer
 * world. Class instances and generators cannot cross the context bridge, so the
 * render-transport IIFE (a page-world script) builds the ApiClient here on top
 * of these primitives.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/** The renderer-visible bridge. */
export interface DshDesktopIpcBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  send(channel: string, payload?: unknown): void
  on(channel: string, listener: (payload: unknown) => void): () => void
}

contextBridge.exposeInMainWorld('__DSH_IPC__', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload),
  send: (channel: string, payload?: unknown): void => {
    ipcRenderer.send(channel, payload)
  },
  on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, data: unknown): void => {
      listener(data)
    }
    ipcRenderer.on(channel, wrapped)
    return () => { ipcRenderer.removeListener(channel, wrapped) }
  },
} satisfies DshDesktopIpcBridge)
