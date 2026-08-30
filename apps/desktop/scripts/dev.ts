/**
 * Development launcher: builds the web dist (relative base), compiles the main
 * process and render transport, copies the web dist, then launches Electron on
 * the compiled main. The host runs from source via the compiled main's tsx-free
 * imports against the built workspace libs.
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import { readDesktopOemConfig, syncDesktopOemIcons } from './desktop-oem-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = resolve(root, '../..')
const require = createRequire(import.meta.url)
const { productName: DESKTOP_PRODUCT_NAME, updateUrl: DESKTOP_UPDATE_URL } = readDesktopOemConfig(repoRoot)
const electronEnvironment = {
  ...process.env,
  DSH_DESKTOP_PRODUCT_NAME: DESKTOP_PRODUCT_NAME,
  DSH_DESKTOP_UPDATE_URL: DESKTOP_UPDATE_URL,
}

function run(cmd: string, cmdArgs: readonly string[], opts: { cwd?: string } = {}): void {
  const windows = process.platform === 'win32'
  const executable = windows ? process.env.ComSpec ?? 'cmd.exe' : cmd
  const args = windows
    // Workspace paths are resolved absolute and contain no spaces in the
    // supported checkout layout; leaving them unquoted avoids cmd.exe passing
    // quote characters through pnpm's own argument parser.
    ? ['/d', '/s', '/c', `${cmd} ${cmdArgs.map(String).join(' ')}`]
    : cmdArgs
  const r = spawnSync(executable, args, { stdio: 'inherit', ...opts })
  if (r.error) {
    console.error(`desktop dev: failed to run ${cmd}: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) process.exit(r.status ?? 1)
}

/** Build the checked-out dsh-im plugin and refresh the active Web profile copy. */
function refreshLocalImPlugin(): void {
  const source = resolve(root, '..', '..', 'dsh-im', 'dsh-im-main')
  run('npm', ['run', 'build'], { cwd: source })
  const target = resolve(process.env.DSH_HOME ?? `${process.env.USERPROFILE ?? ''}\\.dsh`, 'profiles', 'web', 'node_modules', '@xmanrui', 'dsh-im', 'lib')
  mkdirSync(target, { recursive: true })
  for (const file of ['client.js', 'index.js']) copyFileSync(resolve(source, 'lib', file), resolve(target, file))
}

// The web dist must use a relative asset base so the app scheme can serve it;
// build directly into apps/desktop/web to keep apps/web/dist (the served build)
// untouched.
// --emptyOutDir: the outDir is outside the web app's root, so vite would keep
// old hashed chunks otherwise; stale assets linger and confuse diagnosis.
refreshLocalImPlugin()
run('pnpm', [
  'exec',
  'tsc',
  '-b',
  'packages/client/ui-login',
  'packages/client/ui-conversation',
  'packages/client/ui-brand-official',
  'packages/client/ui-layout',
], { cwd: repoRoot })
run('pnpm', ['exec', 'tsdown', '--env.DSH_BUILD_FACE', 'client'], { cwd: repoRoot })
run('pnpm', ['--filter', '@deepseek-ai/dsh-web-frontend', 'exec', 'vite', 'build', '--outDir', resolve(root, 'web'), '--emptyOutDir'], {
  env: { ...process.env, DSH_DESKTOP_BUILD: '1' },
})
syncDesktopOemIcons(repoRoot, root)
run('pnpm', ['build:main'], { cwd: root })
run('node', ['scripts/build-render-transport.mjs'], { cwd: root })

// --expose-internals lets the vendored Loader reach Node's internal ESM loader
// (ModuleLoader.fromInternal), so it resolves bare plugins from the profile
// baseUrl's node_modules like the tsx-launched CLI does.
const child = process.platform === 'win32'
  ? await launchBrandedWindowsElectron()
  : spawn('pnpm', ['exec', 'electron', '--expose-internals', '.'], { cwd: root, stdio: 'inherit', env: electronEnvironment })
child.on('exit', (code) => { process.exit(code ?? 0) })

/** Launch an Electron copy whose PE resources carry the desktop identity. */
async function launchBrandedWindowsElectron(): Promise<ReturnType<typeof spawn>> {
  const electronExecutable = require('electron') as string
  const brandedExecutable = resolve(dirname(electronExecutable), `${DESKTOP_PRODUCT_NAME}-dev.exe`)
  const iconSource = resolve(root, 'build', 'icon.ico')
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
  const desktopVersion = `${manifest.version}.0`

  const executable = NtExecutable.from(readFileSync(electronExecutable))
  const resources = NtExecutableResource.from(executable)
  const icon = Data.IconFile.from(readFileSync(iconSource))
  const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries)
  if (iconGroups.length === 0) throw new Error('desktop dev: Electron executable has no icon group')
  for (const group of iconGroups) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map(item => item.data))
  }

  const versions = Resource.VersionInfo.fromEntries(resources.entries)
  if (versions.length === 0) throw new Error('desktop dev: Electron executable has no version resource')
  for (const version of versions) {
    version.setFileVersion(desktopVersion)
    version.setProductVersion(desktopVersion)
    for (const language of version.getAllLanguagesForStringValues()) version.setStringValues(language, {
      FileDescription: DESKTOP_PRODUCT_NAME,
      InternalName: `${DESKTOP_PRODUCT_NAME}-dev.exe`,
      OriginalFilename: `${DESKTOP_PRODUCT_NAME}-dev.exe`,
      ProductName: DESKTOP_PRODUCT_NAME,
    })
    version.outputToResourceEntries(resources.entries)
  }
  resources.outputResource(executable)
  writeFileSync(brandedExecutable, Buffer.from(executable.generate()))

  return spawn(brandedExecutable, ['--expose-internals', root], { cwd: root, stdio: 'inherit', env: electronEnvironment })
}
