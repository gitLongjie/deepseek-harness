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
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import { renderIndexInjections, type IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { resolveDesktopRenderTransportPath } from '../desktop-paths.ts'
import { pluginBundleRequestUrl } from './loopback-authority.ts'
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'
const CLIENT_MODULES_BOOTSTRAP_PATH = createRequire(import.meta.url).resolve(`${CLIENT_MODULES_ID}/client`)

/**
 * Neutralize the two sequences that desynchronize an inline script's HTML
 * parsing: `</script` closes the element early (`\/` keeps the JS string
 * equal), and `<!--` opens the script's comment-like state so later markup
 * shifts into the document body as text. `\u0021` equals `!` inside strings,
 * templates, and regexes (u-flag included), so both rewrites preserve the JS.
 */
function escapeInlineScript(text: string): string {
  return text
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\u0021--')
}

/**
 * Drop an inlined bundle's trailing `sourceMappingURL` comment. The URL in it is
 * relative to the script's own location, and an inlined script has none: the
 * browser resolves it against the document instead, where the map is missing
 * (each request hangs a 500 in the renderer console) or belongs to another
 * script. The served `/plugins` route keeps the maps for the loader path.
 */
function stripSourceMappingUrl(text: string): string {
  return text.replace(/\n?\/\/# sourceMappingURL=\S+[ \t]*\r?\n?$/, '')
}

/** Resolve one plugin script URL — root-relative, document-relative, single, or combo — to its bundle bytes. */
async function readPluginBundle(modules: ClientModuleRegistry, src: string): Promise<string> {
  const url = pluginBundleRequestUrl(src)
  if (url === undefined) throw new Error(`desktop: not a plugin bundle route ${JSON.stringify(src)}`)
  const response = await modules.fetchBundle(new Request(url))
  if (response.status !== 200) {
    throw new Error(`desktop: no served client bundle for ${JSON.stringify(src)}`)
  }
  return Buffer.from(await response.arrayBuffer()).toString('utf8')
}

/**
 * Compose the injected index.html the desktop shell loads. Collects the live
 * injection table, inlines every script-src row from its source bytes, prepends
 * the render-transport IIFE, and renders the table into the built dist index.
 * @param ctx - the settled boot context carrying webServer and clientModules.
 * @param webDistDir - directory containing the built frontend index.html.
 * @param transportIifePath - absolute path of the built render-transport IIFE.
 * @param clientModulesBootstrapPath - packaged client module bootstrap artifact.
 * @param writeLog - optional desktop-log sink; logs the injection-table shape,
 * because a table without the application batches (or without the
 * client-modules bootstrap, recovered from the packaged artifact here) renders
 * a page that boots zero plugins and waits forever.
 * @returns the injected index.html text.
 */
export async function renderDesktopIndex(
  ctx: Context,
  webDistDir: string,
  transportIifePath: string = resolveDesktopRenderTransportPath(import.meta.url),
  clientModulesBootstrapPath: string = CLIENT_MODULES_BOOTSTRAP_PATH,
  writeLog?: (line: string) => void,
): Promise<string> {
  const server = ctx.get('webServer') as {
    collectIndexInjections(peer: object): IndexInjection[]
  } | undefined
  if (server === undefined) {
    throw new Error('desktop: no webServer service to collect index injections')
  }
  const connection = ctx.get('connection') as { readonly browserPeer: object } | undefined
  const peer = connection?.browserPeer
  if (peer === undefined) {
    throw new Error('desktop: no browser peer to collect index injections')
  }
  const modules = ctx.get('clientModules')
  if (modules === undefined) {
    throw new Error('desktop: no clientModules service to resolve bundle bytes')
  }
  const table = server.collectIndexInjections(peer)
  const preloadRows = table.filter(row => row.kind === 'script-preload').length
  writeLog?.(
    `desktop: index table: ${table.length} rows (${String(preloadRows)} application preloads, `
    + `${String(table.filter(row => row.kind === 'script-src').length)} bootstrap scripts)`,
  )
  if (preloadRows === 0) {
    writeLog?.(
      'desktop: index table carries NO application batches — the client-modules graph composed without '
      + 'client packages; the page will boot zero plugins (see the host boot\'s dsh.client scan warnings)',
    )
  }
  const inline = table.map(async (row): Promise<IndexInjection> => {
    if (row.kind === 'script-preload' && pluginBundleRequestUrl(row.src) !== undefined) {
      // Desktop does not use the browser's HTTP cache for client bundles: the
      // renderer loads them through IPC. Execute application batches inline so
      // their factories enter the module-loader queue before AppWebEntry runs.
      const text = await readPluginBundle(modules, row.src)
      return { kind: 'script', placement: 'head', text: escapeInlineScript(stripSourceMappingUrl(text)) }
    }
    if (row.kind !== 'script-src') return row
    const text = pluginBundleRequestUrl(row.src) !== undefined
      ? await readPluginBundle(modules, row.src)
      : readFileSync(join(webDistDir, row.src), 'utf8')
    return { kind: 'script', placement: row.placement, text: escapeInlineScript(stripSourceMappingUrl(text)) }
  })
  const inlined = await Promise.all(inline)
  // The client module facade is parser-blocking and must register after the
  // queue facade but before the Vite shell entry. A profile assembled without
  // the corresponding index row would otherwise fail only in the renderer,
  // after installation. Recover from the packaged client artifact here so a
  // stale or partial profile cannot produce an unusable desktop window.
  const hasClientModulesBootstrap = table.some(row =>
    row.kind === 'script-src' && row.src.includes(`${CLIENT_MODULES_ID}/client.js`))
  if (!hasClientModulesBootstrap) {
    writeLog?.('desktop: index table has no client-modules bootstrap row; injecting the packaged recovery copy')
    inlined.push({
      kind: 'script',
      placement: 'head',
      text: escapeInlineScript(stripSourceMappingUrl(readFileSync(clientModulesBootstrapPath, 'utf8'))),
    })
  }
  const transport: IndexInjection = {
    kind: 'script',
    placement: 'head',
    text: escapeInlineScript(stripSourceMappingUrl(readFileSync(transportIifePath, 'utf8'))),
  }
  const raw = readFileSync(join(webDistDir, 'index.html'), 'utf8')
  return renderIndexInjections(raw, [transport, ...inlined])
}
