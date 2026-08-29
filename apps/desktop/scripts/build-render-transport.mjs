/**
 * Bundle the render-side transport bootstrap into a page-world IIFE, and the
 * preload bridge into a CommonJS script (Electron's sandboxed preloads cannot
 * load ESM). The client-connection imports on this seam are type-only, so the
 * bundle has no workspace package edges.
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))

await build({
  entryPoints: [resolve(root, 'src/render/entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile: resolve(root, 'dist/render-transport.js'),
  sourcemap: true,
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
