/**
 * Development launcher: builds the web dist (relative base), compiles the main
 * process and render transport, copies the web dist, then launches Electron on
 * the compiled main. The host runs from source via the compiled main's tsx-free
 * imports against the built workspace libs.
 */
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))

function run(cmd: string, cmdArgs: readonly string[], opts: { cwd?: string } = {}): void {
  // shell:true lets Node resolve `.cmd` shims on Windows.
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// The web dist must use a relative asset base so the app scheme can serve it;
// build directly into apps/desktop/web to keep apps/web/dist (the served build)
// untouched.
run('pnpm', ['--filter', '@deepseek-ai/dsh-web-frontend', 'exec', 'vite', 'build', '--outDir', resolve(root, 'web')], {
  env: { ...process.env, DSH_DESKTOP_BUILD: '1' },
})
run('pnpm', ['build:main'], { cwd: root })
run('node', ['scripts/build-render-transport.mjs'], { cwd: root })

// --expose-internals lets the vendored Loader reach Node's internal ESM loader
// (ModuleLoader.fromInternal), so it resolves bare plugins from the profile
// baseUrl's node_modules like the tsx-launched CLI does.
const child = process.platform === 'win32'
  ? spawn('cmd.exe', ['/c', 'pnpm', 'exec', 'electron', '--expose-internals', '.'], { cwd: root, stdio: 'inherit' })
  : spawn('pnpm', ['exec', 'electron', '--expose-internals', '.'], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => { process.exit(code ?? 0) })
