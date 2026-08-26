/**
 * Bundle the render-side transport bootstrap into a page-world IIFE, and the
 * preload bridge into a CommonJS script (Electron's sandboxed preloads cannot
 * load ESM). The AbstractApiClient base is inlined from the apiproxy source so
 * this build does not depend on a prior lib build of the host packages.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = resolve(root, '../..')
const apiproxyClient = resolve(repoRoot, 'packages/host/apiproxy/src/fetch/client.ts')

await build({
  entryPoints: [resolve(root, 'src/render/entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile: resolve(root, 'dist/render-transport.js'),
  sourcemap: true,
  alias: {
    '@deepseek-ai/dsh-host-apiproxy/client': apiproxyClient,
  },
  logLevel: 'info',
})

await build({
  entryPoints: [resolve(root, 'src/preload/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['es2022'],
  external: ['electron'],
  outfile: resolve(root, 'dist/preload/index.js'),
  logLevel: 'info',
})
