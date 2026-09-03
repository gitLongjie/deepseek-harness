/**
 * Package the desktop app: build the web dist with a relative asset base, build
 * the main process and render transport, then run electron-builder directly
 * against apps/desktop (its node_modules already resolves every workspace
 * package). Flags: `--dir` produces the unpacked directory only; `--publish`
 * uploads to the configured GitHub provider.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  createElectronBuilderOemConfig,
  readDesktopOemConfig,
  syncDesktopOemIcons,
} from './desktop-oem-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = resolve(root, '../..')
const dshImRoot = resolve(repoRoot, 'dsh-im', 'dsh-im-main')
const { productName, updateUrl } = readDesktopOemConfig(repoRoot)
// pnpm 11's deps-status check aborts in a non-interactive shell unless CI is
// set; stamp it so every pnpm invocation here inherits it.
process.env.CI = process.env.CI ?? 'true'
const args = process.argv.slice(2)
const dirMode = args.includes('--dir')
const publish = args.includes('--publish')
const localUpdateTest = process.env.DSH_DESKTOP_LOCAL_UPDATE_TEST === '1'

function run(cmd, cmdArgs, opts = {}) {
  // shell:true lets Node resolve `.cmd` shims on Windows.
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// 1. Build the frontend with a relative asset base directly into apps/desktop/web
// (vite outDir outside the web project root), so apps/web/dist stays untouched
// for the served `dsh web` build.
run('pnpm', ['--filter', '@deepseek-ai/dsh-web-frontend', 'exec', 'vite', 'build', '--outDir', resolve(root, 'web')], {
  env: { ...process.env, DSH_DESKTOP_BUILD: '1' },
})
// 1b. The packaged web-runtime's static service resolves
// @deepseek-ai/dsh-web-frontend/dist/index.html (apps/web/dist), which a clean
// CI checkout does not have. Build the default output too so it ships inside
// app.asar; this only affects the packaging run, never the served build.
run('pnpm', ['--filter', '@deepseek-ai/dsh-web-frontend', 'exec', 'vite', 'build'], {
  env: { ...process.env, DSH_DESKTOP_BUILD: '1' },
})
syncDesktopOemIcons(repoRoot, root)
// 2. Build the main process and the render transport.
// dsh-im is a local file dependency rather than a workspace package. Its
// runtime lib/ is generated and absent from a clean GitHub checkout, so build
// it explicitly before staging it for electron-builder.
run('pnpm', ['--dir', dshImRoot, 'run', 'build'])
run('pnpm', ['build:main'], { cwd: root })
run('node', ['scripts/build-render-transport.mjs'], { cwd: root })
// The built module is the asar-unpack manifest's single source of truth, shared
// with the app's boot-time completeness assertions; injecting it here keeps the
// packager and the runtime assertions on one list.
const { ASAR_UNPACK_GLOBS } = await import(
  new URL('../dist/main/desktop/packaged-resources.js', import.meta.url).href
)
// Stage the local file dependency after the TypeScript build (which clears
// dist/) so electron-builder can include it in app.asar.
const dshImStage = resolve(root, 'dist', 'dsh-im-package')
cpSync(dshImRoot, dshImStage, {
  recursive: true,
  filter: (source) => source === dshImRoot
    || /(?:[\\/](?:lib|package\.json|cordis\.patch\.yml))(?:$|[\\/])/.test(source),
})
// 3. Package from apps/desktop itself. electron-builder follows the pnpm
// workspace symlinks in node_modules, excludes devDependencies by the manifest,
// and emits installers to the configured output directory.
const builderConfigPath = resolve(root, 'dist', 'electron-builder.oem.json')
mkdirSync(dirname(builderConfigPath), { recursive: true })
writeFileSync(builderConfigPath, `${JSON.stringify(createElectronBuilderOemConfig(productName, updateUrl, {
  allowLoopbackHttp: localUpdateTest,
  localUpdateFeed: localUpdateTest,
  output: process.env.DSH_DESKTOP_LOCAL_UPDATE_OUTPUT,
  version: process.env.DSH_DESKTOP_BUILD_VERSION,
  asarUnpack: ASAR_UNPACK_GLOBS,
}), null, 2)}\n`)
const ebArgs = ['--config', builderConfigPath]
if (dirMode) ebArgs.push('--dir')
if (publish) ebArgs.push('--publish', 'always')
else ebArgs.push('--publish', 'never')
run('pnpm', ['exec', 'electron-builder', ...ebArgs], { cwd: root })
