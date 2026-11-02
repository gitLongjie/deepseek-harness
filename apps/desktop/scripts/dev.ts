/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { developmentRuntimeDirectory, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject } from './development-project.ts'
import { prepareDevelopmentApp } from './development-app.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'

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

/** Build the checked-out business-entry plugin and refresh the active Web profile copy. */
function refreshLocalBusinessEntryPlugin(): void {
  const source = resolve(root, '..', '..', 'business-entry')
  run('node', ['build.mjs'], { cwd: source })
  const target = resolve(process.env.DSH_HOME ?? `${process.env.USERPROFILE ?? ''}\\.dsh`, 'profiles', 'web', 'node_modules', '@xmanrui', 'dsh-business-entry', 'lib')
  mkdirSync(target, { recursive: true })
  for (const file of ['client.js', 'index.js']) copyFileSync(resolve(source, 'lib', file), resolve(target, file))
  // Also copy cordis.patch.yml so the profile can discover the plugin's patch layer.
  const patchTarget = resolve(process.env.DSH_HOME ?? `${process.env.USERPROFILE ?? ''}\\.dsh`, 'profiles', 'web', 'node_modules', '@xmanrui', 'dsh-business-entry')
  copyFileSync(resolve(source, 'cordis.patch.yml'), resolve(patchTarget, 'cordis.patch.yml'))
  // Copy package.json so the Loader can read dsh.bundle.patch and dsh.client metadata.
  copyFileSync(resolve(source, 'package.json'), resolve(patchTarget, 'package.json'))
}

async function launchElectron(): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = resolve(process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR ?? developmentRuntimeDirectory(),
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
  }
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: userData=${userData}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({ electron, appRoot: APP_ROOT, directory: DEVELOPMENT_ROOT, home, userData,
      mainPort, rendererPort, hostPort, openDevtools: environment.DSH_DESKTOP_OPEN_DEVTOOLS! })
    await run(executable, [], APP_ROOT, environment)
    return
  }
  await run(electron, [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false } } })
  if (!values['skip-build']) {
    await runPackageScript('build:artifacts', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: execFileSync(createRequire(import.meta.url)('electron') as string, ['-p', 'process.versions.node'],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim(),
    pnpmVersion,
  }
  prepareDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    target: resolveDesktopBuildTarget(),
  })
  await preparePrimaryRuntime()
  await launchElectron()
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
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
  await writeBrandedExecutable(brandedExecutable, Buffer.from(executable.generate()))

  return spawn(brandedExecutable, ['--expose-internals', root], { cwd: root, stdio: 'inherit', env: electronEnvironment })
}

/**
 * Write the branded exe, retrying briefly because a freshly written exe can
 * stay locked for a moment by antivirus or the search indexer. A lock that
 * outlives the retries means the previous dev instance still runs the file —
 * Windows refuses to overwrite a running executable — so the error names that
 * remedy instead of surfacing a raw EBUSY stack.
 */
async function writeBrandedExecutable(brandedExecutable: string, contents: Buffer): Promise<void> {
  const name = basename(brandedExecutable)
  for (let attempt = 1; ; attempt += 1) {
    try {
      writeFileSync(brandedExecutable, contents)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EBUSY' && code !== 'EPERM') throw error
      if (attempt < 3) {
        await new Promise<void>(wake => setTimeout(wake, 300))
        continue
      }
      // tasklist exits 0 when the image filter matches, so the check does not
      // depend on the console code page.
      const probe = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${name}`], { encoding: 'utf8' })
      if (probe.status === 0) {
        throw new Error(`desktop dev: an earlier ${name} instance is still running and locks the dev executable — close it (or run: taskkill /F /IM ${name}) and start again`)
      }
      throw new Error(`desktop dev: ${name} stayed locked after retries — another process such as antivirus holds it; retry shortly`)
    }
  }
}
