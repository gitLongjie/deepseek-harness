/**
 * Package the desktop app: build the web dist with a relative asset base, build
 * the main process and render transport, then run electron-builder directly
 * against apps/desktop (its node_modules already resolves every workspace
 * package). Flags: `--dir` produces the unpacked directory only; `--publish`
 * uploads to the configured GitHub provider.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = resolve(root, '../..')
// pnpm 11's deps-status check aborts in a non-interactive shell unless CI is
// set; stamp it so every pnpm invocation here inherits it.
process.env.CI = process.env.CI ?? 'true'
const args = process.argv.slice(2)
const dirMode = args.includes('--dir')
const publish = args.includes('--publish')

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
// 2. Build the main process and the render transport.
run('pnpm', ['build:main'], { cwd: root })
run('node', ['scripts/build-render-transport.mjs'], { cwd: root })
// 3. Package from apps/desktop itself. electron-builder follows the pnpm
// workspace symlinks in node_modules, excludes devDependencies by the manifest,
// and emits installers to the configured output directory.
const ebArgs = ['--config', 'electron-builder.yml']
if (dirMode) ebArgs.push('--dir', '--publish', 'never')
if (publish) ebArgs.push('--publish', 'always')
run('pnpm', ['exec', 'electron-builder', ...ebArgs], { cwd: root })
