/**
 * Bundle-byte service for the desktop shell. Under file:// the `__DSH_BOOT__`
 * entry URLs (`/plugins/<id>/client.js?rev=...`) cannot resolve as HTTP, so the
 * renderer's transport `loadBundle` fetches the bytes over IPC instead. This is
 * the same source the web plugin's `/plugins` HTTP route serves.
 * @module @deepseek-ai/dsh-desktop/ipc/bundle
 */

import { ipcMain } from 'electron'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'

/**
 * Register the loadBundle IPC handler.
 * @param getModules - resolves the current client module registry; `undefined` before the host settles.
 * @returns a disposer that removes the handler.
 */
export function registerBundleIpc(getModules: () => ClientModuleRegistry | undefined): () => void {
  ipcMain.handle('dsh:transport:loadBundle', (_event, req: { url: string }): number[] | undefined => {
    const modules = getModules()
    if (modules === undefined) return undefined
    // Combo URLs (`/plugins/??a/client.js,b/client.js&rev=...`) key the
    // registry's precomputed response table verbatim, exactly like the web
    // plugin's `/plugins` HTTP route.
    if (!req.url.startsWith('/plugins/')) return undefined
    const response = modules.bundleResponse(req.url)
    if (response === undefined) return undefined
    return Array.from(response.body)
  })
  return () => {
    ipcMain.removeHandler('dsh:transport:loadBundle')
  }
}
