/**
 * Package the desktop app (--dir), boot the real unpacked artifact under the
 * smoke harness, and gate on its self-check verdict: exit 0 only when the
 * packaged app boots and every runtime-resource check passes. This is the
 * publication gate — run it locally before sharing an installer, or with
 * `--publish` to publish to the GitHub release only after the smoke passes.
 *
 * Flags:
 *   --skip-build   smoke the existing dist-electron artifact without repackaging
 *   --in-place     smoke the artifact in place instead of from an outside copy
 *   --publish      after a passing smoke, run the full `deploy-app.mjs
 *                  --publish always` release build (GH_TOKEN required)
 *
 * By default the artifact is copied under a temporary path that contains a
 * space and sits outside the repository, mirroring the installed layout
 * (`C:\Program Files\...`): no workspace node_modules may backfill a package
 * the asar forgot, and every spawn path must survive the space.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const desktopRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRoot = resolve(desktopRoot, 'dist-electron')
const args = process.argv.slice(2)
const dirMode = args.includes('--dir')
const skipBuild = args.includes('--skip-build')
const inPlace = args.includes('--in-place')
const publishAfterSmoke = args.includes('--publish')
const timeoutIndex = args.indexOf('--timeout-ms')
const smokeTimeoutMs = timeoutIndex === -1 ? 300_000 : Number(args[timeoutIndex + 1])

/** Run a deploy step under the current Node executable (no shell: execPath may contain spaces). */
function runDeploy(deployArgs) {
  const r = spawnSync(process.execPath, ['scripts/deploy-app.mjs', ...deployArgs], {
    stdio: 'inherit',
    cwd: desktopRoot,
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

/** Locate the unpacked app executable electron-builder just produced. */
export function findPackagedExecutable(platform = process.platform, root = outputRoot) {
  if (!existsSync(root)) {
    throw new Error(`no packaged output at ${root}; run the packaging step first`)
  }
  const entries = readdirSync(root, { withFileTypes: true })
  if (platform === 'win32') {
    const dir = join(root, 'win-unpacked')
    const exes = existsSync(dir)
      ? readdirSync(dir).filter(name => name.toLowerCase().endsWith('.exe'))
      : []
    if (exes.length === 1) return join(dir, exes[0])
    throw new Error(`expected exactly one .exe in ${dir}, found [${exes.join(', ')}]`)
  }
  if (platform === 'darwin') {
    const bundles = entries
      .filter(entry => entry.isDirectory() && (entry.name === 'mac' || entry.name.startsWith('mac-')))
      .flatMap(dirEntry => readdirSync(join(root, dirEntry.name))
        .filter(name => name.endsWith('.app'))
        .map(name => join(root, dirEntry.name, name, 'Contents', 'MacOS', name.replace(/\.app$/, ''))))
      .filter(candidate => existsSync(candidate))
    if (bundles.length === 1) return bundles[0]
    throw new Error(`expected exactly one .app bundle under ${root}/mac*, found [${bundles.join(', ')}]`)
  }
  if (platform === 'linux') {
    const dir = join(root, 'linux-unpacked')
    const exes = existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter(entry => entry.isFile() && statSync(join(dir, entry.name)).mode & 0o111 && !entry.name.includes('.so'))
          .map(entry => entry.name)
      : []
    // Electron helpers (chrome-sandbox, chrome_crashpad_handler) match the
    // mode filter too; the declared executable name from the builder config
    // picks the app binary out of that set.
    const declared = yaml.load(readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8'))?.linux?.executableName
    const preferred = typeof declared === 'string' && exes.includes(declared) ? [declared] : exes
    if (preferred.length === 1) return join(dir, preferred[0])
    throw new Error(`expected exactly one executable in ${dir}, found [${exes.join(', ')}]`)
  }
  throw new Error(`unsupported smoke platform: ${platform}`)
}

/**
 * Copy the packaged layout under a path with a space, outside the repository:
 * the destination machine installs under `C:\Program Files\...` — a space, and
 * no workspace `node_modules` above the app — so both properties must be part
 * of the smoke's reality. A missing package that the checkout's node_modules
 * accidentally backfills would otherwise pass the in-repo smoke and fail the
 * installed app.
 * @param executable - the packaged executable inside the checkout output.
 * @param copyRoot - an existing directory to copy the app layout into.
 * @returns the copied app root and the executable inside it.
 */
function copyOutsideRepo(executable, copyRoot) {
  const sourceRoot = process.platform === 'darwin'
    ? dirname(dirname(dirname(executable)))
    : dirname(executable)
  const leaf = process.platform === 'darwin' ? `${basename(sourceRoot)} copy` : 'DSH Desktop copy'
  const targetRoot = join(copyRoot, leaf)
  cpSync(sourceRoot, targetRoot, { recursive: true })
  return { root: targetRoot, executable: join(targetRoot, relative(sourceRoot, executable)) }
}

/** Build the isolated launch environment: its own userData, DSH home, and result sinks. */
export function smokeEnvironment(runDir, extra = {}) {
  return {
    ...process.env,
    DSH_PACKAGED_SMOKE: '1',
    DSH_PACKAGED_SMOKE_USER_DATA: join(runDir, 'userdata'),
    DSH_PACKAGED_SMOKE_RESULT: join(runDir, 'smoke-result.json'),
    DSH_DESKTOP_LOG: join(runDir, 'desktop.log'),
    DSH_HOME: join(runDir, 'dsh-home'),
    DSH_TELEMETRY_DISABLED: '1',
    ...extra,
  }
}

async function main() {
  if (skipBuild) {
    console.log('Skipping packaging; smoking the existing dist-electron artifact.')
  } else {
    console.log('Packaging (--dir) for the smoke run...')
    runDeploy(['--dir'])
  }

  const executable = findPackagedExecutable()
  const outsideCopyRoot = inPlace ? null : mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-app-'))
  const smokeTarget = outsideCopyRoot === null
    ? { root: dirname(executable), executable }
    : copyOutsideRepo(executable, outsideCopyRoot)
  console.log(`Smoke target: ${smokeTarget.executable}`)
  const runDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const launchArgs = process.platform === 'linux' ? ['--no-sandbox'] : []
  const result = spawnSync(smokeTarget.executable, launchArgs, {
    timeout: smokeTimeoutMs,
    encoding: 'utf8',
    env: smokeEnvironment(runDir),
  })
  if (outsideCopyRoot !== null) rmSync(smokeTarget.root, { recursive: true, force: true })
  const logText = existsSync(join(runDir, 'desktop.log'))
    ? readFileSync(join(runDir, 'desktop.log'), 'utf8')
    : ''
  const resultPath = join(runDir, 'smoke-result.json')
  let verdict
  if (existsSync(resultPath)) {
    verdict = JSON.parse(readFileSync(resultPath, 'utf8'))
  }

  const failures = []
  if (result.error !== undefined) failures.push(`launch error: ${result.error.message}`)
  if (result.status !== 0) {
    failures.push(`packaged app exited ${String(result.status)}${result.signal === null ? '' : ` on signal ${result.signal}`}`)
  }
  if (verdict === undefined) failures.push(`no smoke result file at ${resultPath}`)
  else {
    for (const check of verdict.checks ?? []) {
      console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`)
      if (!check.ok) failures.push(`${check.name}: ${check.detail}`)
    }
  }

  if (failures.length > 0) {
    console.error(`\nPackaged smoke FAILED:\n  - ${failures.join('\n  - ')}`)
    if (logText !== '') {
      console.error(`\n--- desktop.log (${join(runDir, 'desktop.log')}) ---`)
      console.error(logText.trimEnd())
    }
    if (result.stdout !== '') console.error(`\n--- stdout ---\n${result.stdout.trimEnd()}`)
    if (result.stderr !== '') console.error(`\n--- stderr ---\n${result.stderr.trimEnd()}`)
    console.error(`run directory kept for diagnosis: ${runDir}`)
    process.exit(1)
  }
  if (verdict.ok !== true) {
    console.error('Packaged smoke FAILED: the verdict file did not report ok.')
    process.exit(1)
  }
  rmSync(runDir, { recursive: true, force: true })
  console.log('Packaged smoke passed: the artifact boots with every runtime resource in place.')

  if (publishAfterSmoke) {
    console.log('\nSmoke passed; packaging and publishing the release build...')
    runDeploy(['--publish', 'always'])
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
