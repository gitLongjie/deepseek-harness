/**
 * Bundle-byte service for the desktop shell. Under file:// the `__DSH_BOOT__`
 * entry URLs (`/plugins/<id>/client.js?rev=...`) cannot resolve as HTTP, so the
 * renderer's transport `loadBundle` fetches the bytes over IPC instead. This is
 * the same source the web plugin's `/plugins` HTTP route serves.
 * @module @deepseek-ai/dsh-desktop/ipc/bundle
 */

import { ipcMain } from 'electron'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import { LOOPBACK_AUTHORITY } from './loopback-authority.ts'

/**
 * Register the loadBundle IPC handler.
 * @param getModules - resolves the current client module registry; `undefined` before the host settles.
 * @param writeLog - optional desktop-log sink; every request is logged with its
 * outcome and duration, so a renderer boot wedged on bundle arrival is
 * diagnosable from the log alone — a request absent from the log never
 * reached the main process.
 * @returns a disposer that removes the handler.
 */
export function registerBundleIpc(
  getModules: () => ClientModuleRegistry | undefined,
  writeLog?: (line: string) => void,
): () => void {
  ipcMain.handle('dsh:transport:loadBundle', async (_event, req: { url: string }): Promise<number[] | undefined> => {
    const started = Date.now()
    const finish = (outcome: string): void => {
      writeLog?.(`desktop: loadBundle ${req.url} -> ${outcome} in ${Date.now() - started}ms`)
    }
    const modules = getModules()
    if (modules === undefined) {
      finish('miss (host not settled)')
      return undefined
    }
    // Combo URLs (`/plugins/??a/client.js,b/client.js&rev=...`) resolve through
    // the registry's bundle table verbatim, exactly like the web plugin's
    // `/plugins` HTTP route.
    if (!req.url.startsWith('/plugins/')) {
      finish('miss (not a /plugins URL)')
      return undefined
    }
    // The registry reads the resource off the request URL, which arrives
    // root-relative because the entry URLs are.
    const response = await modules.fetchBundle(new Request(new URL(req.url, LOOPBACK_AUTHORITY)))
    if (response.status !== 200) {
      finish(`miss (status ${response.status})`)
      return undefined
    }
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()))
    finish(`${bytes.length} bytes`)
    return bytes
  })
  return () => {
    ipcMain.removeHandler('dsh:transport:loadBundle')
  }
}
