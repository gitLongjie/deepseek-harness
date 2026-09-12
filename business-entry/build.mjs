/**
 * Build script for the standalone business-entry plugin.
 * Produces lib/client.js (browser bundle) and lib/index.js (host entry).
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = dirname(fileURLToPath(import.meta.url))
const loaderId = '@xmanrui/dsh-business-entry'

async function buildClient() {
  const result = await build({
    entryPoints: [resolve(root, 'src/client.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome100'],
    // React and framework modules come from the module table (external).
    external: [
      'react',
      'react-dom',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-sidebar',
      '@deepseek-ai/dsh-client-ui-slots',
    ],
    write: false,
    minify: process.env.NODE_ENV === 'production',
    legalComments: 'none',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  })
  const bundled = result.outputFiles?.[0]?.text
  if (!bundled) throw new Error('esbuild did not produce a client bundle')

  const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(loaderId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${bundled}
    return module.exports;
  }
});
`
  const outPath = resolve(root, 'lib/client.js')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, wrapped, 'utf8')
  console.log(`Wrote ${outPath}`)
}

async function buildHost() {
  const outPath = resolve(root, 'lib/index.js')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, 'export function apply() {}\n', 'utf8')
  console.log(`Wrote ${outPath}`)
}

await Promise.all([buildClient(), buildHost()])
