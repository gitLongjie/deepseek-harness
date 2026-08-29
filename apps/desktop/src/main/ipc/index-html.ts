/**
 * Offline index.html composition for the desktop shell. The served web app
 * renders the injection table through the webserver's HTTP fallback; the
 * desktop shell renders the same table into a file:// document instead, then
 * loads it from the real filesystem (userData), where absolute /plugins URLs
 * cannot resolve. It inlines every script-src row — the module-system preload
 * bundles from their host bytes and the render-transport IIFE — and leaves the
 * relative asset URLs from a desktop-build web dist intact.
 * @module @deepseek-ai/dsh-desktop/ipc/index-html
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import { renderIndexInjections, type IndexInjection } from '@deepseek-ai/dsh-host-webserver'

/** The built render-transport IIFE, inlined ahead of the module-system queue. */
const TRANSPORT_IIFE_PATH = fileURLToPath(new URL('../../render-transport.js', import.meta.url))

/** `</script` closes the element early when inlined; `\/` keeps the string equal. */
function escapeInlineScript(text: string): string {
  return text.replace(/<\/script/gi, '<\\/script')
}

/** Resolve one `/plugins` script-src URL — single or combo — to its bundle bytes. */
function readPluginBundle(modules: ClientModuleRegistry, src: string): string {
  const response = modules.bundleResponse(src)
  if (response === undefined) {
    throw new Error(`desktop: no served client bundle for ${JSON.stringify(src)}`)
  }
  return response.body.toString('utf8')
}

/**
 * Compose the injected index.html the desktop shell loads. Collects the live
 * injection table, inlines every script-src row from its source bytes, prepends
 * the render-transport IIFE, and renders the table into the built dist index.
 * @param ctx - the settled boot context carrying webServer and clientModules.
 * @param webDistDir - directory containing the built frontend index.html.
 * @param transportIifePath - absolute path of the built render-transport IIFE.
 * @returns the injected index.html text.
 */
export function renderDesktopIndex(
  ctx: Context,
  webDistDir: string,
  transportIifePath: string = TRANSPORT_IIFE_PATH,
): string {
  const server = ctx.get('webServer') as { collectIndexInjections(): IndexInjection[] } | undefined
  if (server === undefined) {
    throw new Error('desktop: no webServer service to collect index injections')
  }
  const modules = ctx.get('clientModules')
  if (modules === undefined) {
    throw new Error('desktop: no clientModules service to resolve bundle bytes')
  }
  const table = server.collectIndexInjections()
  const inline = table.map((row): IndexInjection => {
    if (row.kind !== 'script-src') return row
    const text = row.src.startsWith('/plugins/')
      ? readPluginBundle(modules, row.src)
      : readFileSync(join(webDistDir, row.src), 'utf8')
    return { kind: 'script', placement: row.placement, text: escapeInlineScript(text) }
  })
  const transport: IndexInjection = {
    kind: 'script',
    placement: 'head',
    text: escapeInlineScript(readFileSync(transportIifePath, 'utf8')),
  }
  const raw = readFileSync(join(webDistDir, 'index.html'), 'utf8')
  return renderIndexInjections(raw, [transport, ...inline])
}
