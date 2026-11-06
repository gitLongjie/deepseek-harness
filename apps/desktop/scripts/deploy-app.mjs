/**
 * Package the desktop app: build the web dist with a relative asset base, build
 * the main process and render transport, then run electron-builder directly
 * against apps/desktop (its node_modules already resolves every workspace
 * package). Flags: `--dir` produces the unpacked directory only; `--publish`
 * uploads to the configured GitHub provider.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import yaml from 'js-yaml'
import {
  createElectronBuilderOemConfig,
  readDesktopOemConfig,
  syncDesktopOemIcons,
} from './desktop-oem-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = resolve(root, '../..')
const dshImRoot = resolve(repoRoot, 'dsh-im', 'dsh-im-main')
const businessEntryRoot = resolve(repoRoot, 'business-entry')
const { productName, updateUrl, knowledgeBase, gatewayProviderName, helpDocsUrl } = readDesktopOemConfig(repoRoot)
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

// 0. Rebuild every workspace lib/ artifact first. The packaged node_modules
// ships these files verbatim, and the frontend and main-process builds below
// consume the same lib/ outputs, so packaging over stale or missing libs
// ships whatever was last built; rebuilding here keeps the payload fresh.
// The artifacts scope, not the default: packaging consumes lib/ outputs only,
// and the default's aggregate checks cost memory the macOS runner (7 GB)
// cannot hold — the runner dies mid-build and the job logs upload nothing.
run('pnpm', ['run', 'build:artifacts'], { cwd: repoRoot })

// 0b. app.asar copies the workspace @deepseek-ai/node-addon-system-<platform>-<arch>
// packages verbatim, and their bin/system.node is ignored build output; without
// it the packaged flock entry fails with "Cannot find module .../bin/system.node".
// macOS packages every mac target arch from one host, so each one is built here.
if (process.platform === 'darwin') {
  const builderConfig = yaml.load(readFileSync(resolve(root, 'electron-builder.yml'), 'utf8'))
  const macArchitectures = new Set(builderConfig.mac.target.flatMap(target => target.arch))
  for (const arch of macArchitectures) {
    run('pnpm', ['exec', 'tsx', 'native/system/scripts/build.ts', '--host-addon-only', '--arch', arch], { cwd: repoRoot })
  }
} else if (process.platform === 'linux') {
  run('pnpm', ['run', 'build:native-system'], { cwd: repoRoot })
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
// dsh-im and business-entry are workspace plugin packages whose runtime lib/ is
// generated and absent from a clean GitHub checkout, so build them explicitly
// through their workspace installs before staging them for electron-builder.
run('pnpm', ['--dir', dshImRoot, 'run', 'build'])
run('pnpm', ['--dir', businessEntryRoot, 'run', 'build'])
run('pnpm', ['build:main'], { cwd: root })
run('node', ['scripts/build-render-transport.mjs'], { cwd: root })
// The built module is the asar-unpack manifest's single source of truth, shared
// with the app's boot-time completeness assertions; injecting it here keeps the
// packager and the runtime assertions on one list.
const { ASAR_UNPACK_GLOBS } = await import(
  new URL('../dist/main/desktop/packaged-resources.js', import.meta.url).href
)
// The ComfyUI distribution is an optional out-of-asar payload: drop a ComfyUI
// program tree (python_embeded + ComfyUI sources, NO model weights) at
// apps/desktop/resources/comfyui-dist and it ships beside the app under
// resources/comfyui-dist; the first launch copies it into the user-writable
// local-app-data directory the h3-video-director preset points at. An absent
// directory packages without it (remote MiniMax backend only).
const comfyDistDir = resolve(root, 'resources', 'comfyui-dist')
const extraResources = existsSync(comfyDistDir)
  ? [{ from: comfyDistDir, to: 'comfyui-dist' }]
  : undefined
// Stage the local file dependency after the TypeScript build (which clears
// dist/) so electron-builder can include it in app.asar.
const dshImStage = resolve(root, 'dist', 'dsh-im-package')
cpSync(dshImRoot, dshImStage, {
  recursive: true,
  filter: (source) => source === dshImRoot
    || /(?:[\\/](?:lib|package\.json|cordis\.patch\.yml))(?:$|[\\/])/.test(source),
})
// Stage the business-entry plugin for electron-builder.
const businessEntryStage = resolve(root, 'dist', 'business-entry-package')
cpSync(businessEntryRoot, businessEntryStage, {
  recursive: true,
  filter: (source) => source === businessEntryRoot
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
  knowledgeBase,
  gatewayProviderName,
  helpDocsUrl,
  output: process.env.DSH_DESKTOP_LOCAL_UPDATE_OUTPUT,
  version: process.env.DSH_DESKTOP_BUILD_VERSION,
  asarUnpack: ASAR_UNPACK_GLOBS,
  extraResources,
}), null, 2)}\n`)
const ebArgs = ['--config', builderConfigPath]
if (dirMode) ebArgs.push('--dir')
if (publish) ebArgs.push('--publish', 'always')
else ebArgs.push('--publish', 'never')
run('pnpm', ['exec', 'electron-builder', ...ebArgs], { cwd: root })
