/**
 * Package the desktop app: build the web dist with a relative asset base, build
 * the main process and render transport, then run electron-builder directly
 * against apps/desktop (its node_modules already resolves every workspace
 * package). Flags: `--dir` produces the unpacked directory only; `--publish`
 * uploads to the configured GitHub provider.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
const dshImNodeModules = resolve(dshImRoot, 'node_modules')
mkdirSync(dshImNodeModules, { recursive: true })
for (const dependency of ['esbuild', 'semver']) {
  const target = resolve(dshImNodeModules, dependency)
  rmSync(target, { recursive: true, force: true })
  cpSync(realpathSync(resolve(root, 'node_modules', dependency)), target, {
    recursive: true,
  })
}
const esbuildPlatform = `${process.platform}-${process.arch}`
const esbuildPackage = esbuildPlatform === 'darwin-arm64' ? '@esbuild/darwin-arm64'
  : esbuildPlatform === 'darwin-x64' ? '@esbuild/darwin-x64'
    : esbuildPlatform === 'linux-x64' ? '@esbuild/linux-x64'
      : esbuildPlatform === 'win32-x64' ? '@esbuild/win32-x64' : undefined
if (esbuildPackage !== undefined) {
  // pnpm keeps the scope marker in store directory names, e.g.
  // `@esbuild+win32-x64@0.28.2`.
  const packageDirectory = esbuildPackage.replace('/', '+')
  const pnpmStore = resolve(repoRoot, 'node_modules', '.pnpm')
  const storeEntry = readdirSync(pnpmStore).find((entry) => entry.startsWith(`${packageDirectory}@`))
  if (storeEntry === undefined) throw new Error(`desktop: missing ${esbuildPackage} platform package`)
  const source = resolve(pnpmStore, storeEntry, 'node_modules', esbuildPackage)
  const target = resolve(dshImNodeModules, esbuildPackage)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
}
run('pnpm', ['--dir', dshImRoot, 'run', 'build'])
run('pnpm', ['build:main'], { cwd: root })
run('node', ['scripts/build-render-transport.mjs'], { cwd: root })
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
}), null, 2)}\n`)
const ebArgs = ['--config', builderConfigPath]
if (dirMode) ebArgs.push('--dir')
if (publish) ebArgs.push('--publish', 'always')
else ebArgs.push('--publish', 'never')
run('pnpm', ['exec', 'electron-builder', ...ebArgs], { cwd: root })
