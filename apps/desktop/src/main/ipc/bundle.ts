/**
 * Bundle-byte service for the desktop shell. Under file:// the `__DSH_BOOT__`
 * entry URLs (`/plugins/<id>/client.js?rev=...`) cannot resolve as HTTP, so the
 * renderer's transport `loadBundle` fetches the bytes over IPC instead. This is
 * the same source the web plugin's `/plugins` HTTP route serves.
 * @module @deepseek-ai/dsh-desktop/ipc/bundle
 */

import { readFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'

/**
 * Register the loadBundle IPC handler.
 * @param getModules - resolves the current client module registry; `undefined` before the host settles.
 * @returns a disposer that removes the handler.
 */
export function registerBundleIpc(getModules: () => ClientModuleRegistry | undefined): () => void {
  ipcMain.handle('dsh:transport:loadBundle', async (_event, req: { url: string }): Promise<number[] | undefined> => {
    const modules = getModules()
    if (modules === undefined) return undefined
    const query = req.url.indexOf('?')
    const pathname = decodeURIComponent(query === -1 ? req.url : req.url.slice(0, query))
    const prefix = '/plugins/'
    const suffix = '/client.js'
    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined
    const id = pathname.slice(prefix.length, -suffix.length)
    const bundlePath = modules.clientPath(id)
    if (bundlePath === undefined) return undefined
    return Array.from(await readFile(bundlePath))
  })
  return () => {
    ipcMain.removeHandler('dsh:transport:loadBundle')
  }
}
