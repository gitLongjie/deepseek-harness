import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SpawnScript {
  code: number | null
  stdout?: string
  stderr?: string
  error?: Error
  delayMs?: number
  /** Simulate the package manager's own file changes before the child closes. */
  mutate?: () => void
}

const spawnControl = vi.hoisted(() => ({
  calls: [] as Array<{ args: readonly string[]; options: Record<string, unknown> }>,
  script: null as null | ((args: readonly string[]) => SpawnScript),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  return {
    ...actual,
    spawn: (_command: string, args: readonly string[], options: Record<string, unknown>) => {
      spawnControl.calls.push({ args, options })
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        kill: () => void
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = vi.fn()
      queueMicrotask(() => {
        const script = spawnControl.script?.(args) ?? { code: 0 }
        if (script.mutate !== undefined) script.mutate()
        const emit = (): void => {
          if (script.stdout !== undefined) child.stdout.emit('data', Buffer.from(script.stdout))
          if (script.stderr !== undefined) child.stderr.emit('data', Buffer.from(script.stderr))
          if (script.error !== undefined) {
            child.emit('error', script.error)
            return
          }
          child.emit('close', script.code)
        }
        if (script.delayMs === undefined) emit()
        else setTimeout(emit, script.delayMs)
      })
      return child
    },
  }
})

const { bundleId, ensureProfileDir, isNpmPackageName, pnpmInstall, pnpmUninstall, readInstalledPlugins } = await import('../src/profile-io.ts')

const BIN = 'dsh-test'
const ANCHOR = join(tmpdir(), 'dsh-market-nonexistent-anchor', 'package.json')
const OPTIONS_BASE = { installAnchor: ANCHOR, pnpmTimeoutMs: 5_000, maxOutputTailBytes: 8_000 }

const homes: string[] = []

beforeEach(() => {
  spawnControl.calls.length = 0
  spawnControl.script = null
})

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

function tempProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-market-profile-'))
  homes.push(dir)
  return dir
}

/** Write a profile manifest and, optionally, its resolvable node_modules dependencies. */
function stageProfile(
  dir: string,
  deps: Record<string, { bundle?: boolean; resolvable?: boolean; version?: string }> = {},
  bundles: string[] = [],
): void {
  mkdirSync(dir, { recursive: true })
  const dependencies: Record<string, string> = {}
  for (const [name, spec] of Object.entries(deps)) {
    dependencies[name] = spec.version ?? '1.0.0'
    if (spec.resolvable === false) continue
    const depDir = join(dir, 'node_modules', name)
    mkdirSync(depDir, { recursive: true })
    writeFileSync(join(depDir, 'package.json'), JSON.stringify({
      name,
      version: spec.version ?? '1.0.0',
      type: 'module',
      main: './index.js',
      ...(spec.bundle === true ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {}),
    }))
    writeFileSync(join(depDir, 'index.js'), '')
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-t',
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }))
}

function manifestBundles(dir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  return manifest.dsh?.profile?.bundles ?? []
}

function manifestDependencies(dir: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  return manifest.dependencies ?? {}
}

describe('isNpmPackageName', () => {
  it('accepts the npm name grammar and rejects everything else', () => {
    expect(isNpmPackageName('pkg')).toBe(true)
    expect(isNpmPackageName('@scope/pkg.name')).toBe(true)
    expect(isNpmPackageName('a.b-c_d~e')).toBe(true)
    expect(isNpmPackageName('')).toBe(false)
    expect(isNpmPackageName('@scope')).toBe(false)
    expect(isNpmPackageName('PKG')).toBe(false)
    expect(isNpmPackageName('.lead')).toBe(false)
    expect(isNpmPackageName('pkg name')).toBe(false)
    expect(isNpmPackageName('pkg/inner')).toBe(false)
  })
})

describe('bundleId', () => {
  it('rebrands a validated package name', () => {
    expect(bundleId('@scope/pkg')).toBe('@scope/pkg')
  })
})

describe('ensureProfileDir', () => {
  it('creates an unknown profile with the default bundle layer', () => {
    const dir = tempProfile()
    ensureProfileDir('never-a-template', dir)
    expect(manifestBundles(dir)).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('seeds a known template with its template bundles and leaves an existing profile untouched', () => {
    const dir = tempProfile()
    ensureProfileDir('web', dir)
    const templateBundles = manifestBundles(dir)
    expect(templateBundles.length).toBeGreaterThan(0)

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-t', private: true, dsh: { profile: { bundles: ['kept'] } } }))
    ensureProfileDir('web', dir)
    expect(manifestBundles(dir)).toEqual(['kept'])
  })
})

describe('readInstalledPlugins', () => {
  it('lists dependencies first with specs, then installation-owned template layers', () => {
    const dir = tempProfile()
    stageProfile(dir, {
      'dep-bundle': { bundle: true, version: '2.0.0' },
      'dep-plain': { bundle: false },
      ghost: { resolvable: false },
    }, ['dep-bundle', 'template-layer'])
    // An unparseable dependency manifest reports no version rather than failing the view.
    writeFileSync(join(dir, 'node_modules', 'dep-plain', 'package.json'), '{ not json')
    const rows = readInstalledPlugins(BIN, dir, ANCHOR)
    expect(rows).toEqual([
      { bundleId: 'dep-bundle', packageName: 'dep-bundle', version: '2.0.0', spec: '2.0.0', isBundleLayer: true, removable: true },
      { bundleId: 'dep-plain', packageName: 'dep-plain', version: null, spec: '1.0.0', isBundleLayer: false, removable: true },
      { bundleId: 'ghost', packageName: 'ghost', version: null, spec: '1.0.0', isBundleLayer: false, removable: true },
      { bundleId: 'template-layer', packageName: 'template-layer', version: null, spec: null, isBundleLayer: true, removable: false },
    ])
  })

  it('reports an empty-string dependency version as no version', () => {
    const dir = tempProfile()
    stageProfile(dir, { 'dep-empty': { bundle: true, version: '' } })
    const rows = readInstalledPlugins(BIN, dir, ANCHOR)
    expect(rows[0]?.version).toBeNull()
  })

  it('handles a hand-written manifest without dsh or dependencies blocks', () => {
    const dir = tempProfile()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-t', private: true }))
    expect(readInstalledPlugins(BIN, dir, ANCHOR)).toEqual([])
  })

  it('fails loud when the profile manifest is unreadable', () => {
    const dir = tempProfile()
    expect(() => readInstalledPlugins(BIN, dir, ANCHOR)).toThrow(/failed to read profile manifest/)
  })
})

describe('pnpmInstall', () => {
  it('adds the exact version, reconciles the bundle layer, and reports restartRequired', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    const profileDir = dir
    spawnControl.script = (args) => {
      expect(args).toEqual(['add', 'pkg-one@1.2.3'])
      return {
        code: 0,
        mutate: () => {
          const dependencies = manifestDependencies(profileDir)
          dependencies['pkg-one'] = '1.2.3'
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
            name: 'dsh-profile-t',
            private: true,
            dependencies,
            dsh: { profile: { bundles: manifestBundles(profileDir) } },
          }))
          const depDir = join(profileDir, 'node_modules', 'pkg-one')
          mkdirSync(depDir, { recursive: true })
          writeFileSync(join(depDir, 'package.json'), JSON.stringify({
            name: 'pkg-one', version: '1.2.3', type: 'module', main: './index.js',
            dsh: { bundle: { patch: './cordis.patch.yml' } },
          }))
          writeFileSync(join(depDir, 'index.js'), '')
        },
      }
    }
    const outcome = await pnpmInstall(BIN, 'pkg-one', '1.2.3', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toEqual({ ok: true, packageName: 'pkg-one', version: '1.2.3', restartRequired: true })
    expect(manifestBundles(dir)).toEqual(['pkg-one'])
    expect(spawnControl.calls[0]?.options.cwd).toBe(dir)
    expect(spawnControl.calls[0]?.options.shell).toBe(process.platform === 'win32')
  })

  it('runs pnpm without a shell off Windows', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      spawnControl.script = () => ({ code: 0, mutate: () => {} })
      await pnpmInstall(BIN, 'pkg-one', '1.2.3', { ...OPTIONS_BASE, profileDir: dir })
      expect(spawnControl.calls[0]?.options.shell).toBe(false)
    } finally {
      if (descriptor !== undefined) Object.defineProperty(process, 'platform', descriptor)
    }
  })

  it('keeps the bundle layer unchanged when the added dependency declares no dsh.bundle', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    const profileDir = dir
    spawnControl.script = () => ({
      code: 0,
      mutate: () => {
        const dependencies = manifestDependencies(profileDir)
        dependencies['pkg-bare'] = '0.1.0'
        writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
          name: 'dsh-profile-t',
          private: true,
          dependencies,
          dsh: { profile: { bundles: manifestBundles(profileDir) } },
        }))
        const depDir = join(profileDir, 'node_modules', 'pkg-bare')
        mkdirSync(depDir, { recursive: true })
        writeFileSync(join(depDir, 'package.json'), JSON.stringify({ name: 'pkg-bare', version: '0.1.0', type: 'module', main: './index.js' }))
        writeFileSync(join(depDir, 'index.js'), '')
      },
    })
    // The reconcile's bundle-less warning reaches the discarded sink.
    const outcome = await pnpmInstall(BIN, 'pkg-bare', '0.1.0', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toEqual({ ok: true, packageName: 'pkg-bare', version: '0.1.0', restartRequired: true })
    expect(manifestBundles(dir)).toEqual([])
  })

  it('reports a failed add with the captured output tail', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    spawnControl.script = () => ({ code: 1, stderr: 'ERR_Pnpm 404 not found\n' })
    const outcome = await pnpmInstall(BIN, 'pkg-one', '1.2.3', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toEqual({
      ok: false,
      message: 'pnpm add pkg-one@1.2.3 failed with exit code 1',
      outputTail: 'ERR_Pnpm 404 not found\n',
    })
  })

  it('reports a spawn failure such as a missing pnpm, appending to captured output', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    spawnControl.script = () => ({
      code: null,
      stdout: 'partial output\n',
      error: Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' }),
    })
    const outcome = await pnpmInstall(BIN, 'pkg-one', '1.2.3', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toMatchObject({ ok: false, message: 'pnpm add pkg-one@1.2.3 failed with exit code spawn error' })
    expect((outcome as { outputTail: string | null }).outputTail).toContain('ENOENT')
    expect((outcome as { outputTail: string | null }).outputTail).toContain('partial output')
  })

  it('kills the child at the timeout and reports the timeout', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    spawnControl.script = () => ({ code: 0, delayMs: 300 })
    const outcome = await pnpmInstall(BIN, 'pkg-one', '1.2.3', { ...OPTIONS_BASE, profileDir: dir, pnpmTimeoutMs: 20 })
    expect(outcome).toMatchObject({ ok: false, message: 'pnpm add pkg-one@1.2.3 timed out after 20ms' })
  })

  it('keeps only the bounded output tail', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    spawnControl.script = () => ({ code: 1, stdout: 'x'.repeat(100) })
    const outcome = await pnpmInstall(BIN, 'pkg-one', '1.2.3', { ...OPTIONS_BASE, profileDir: dir, maxOutputTailBytes: 10 })
    expect((outcome as { outputTail: string | null }).outputTail).toHaveLength(10)
  })

  it('trims whole chunks across merged stdout and stderr when over the bound', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    spawnControl.script = () => ({ code: 1, stdout: 'a'.repeat(50), stderr: 'b'.repeat(50) })
    const outcome = await pnpmInstall(BIN, 'pkg-one', '1.2.3', { ...OPTIONS_BASE, profileDir: dir, maxOutputTailBytes: 10 })
    expect((outcome as { outputTail: string | null }).outputTail).toBe('b'.repeat(10))
  })
})

describe('pnpmUninstall', () => {
  it('refuses packages the profile does not dependency-manage', async () => {
    const dir = tempProfile()
    stageProfile(dir)
    const outcome = await pnpmUninstall(BIN, 'pkg-one', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toEqual({
      ok: false,
      message: 'pkg-one is not a dependency-managed plugin of this profile; installation-owned layers are removed through a profile reset',
      outputTail: null,
    })
    expect(spawnControl.calls).toHaveLength(0)
  })

  it('removes the dependency and drops its bundle layer', async () => {
    const dir = tempProfile()
    stageProfile(dir, { 'pkg-one': { bundle: true } }, ['pkg-one'])
    const profileDir = dir
    spawnControl.script = (args) => {
      expect(args).toEqual(['remove', 'pkg-one'])
      return {
        code: 0,
        mutate: () => {
          const dependencies = manifestDependencies(profileDir)
          delete dependencies['pkg-one']
          // A concurrently appearing bundle-less dependency fires the
          // reconcile warning, which the uninstall path discards.
          dependencies['pkg-bare'] = '0.1.0'
          mkdirSync(join(profileDir, 'node_modules', 'pkg-bare'), { recursive: true })
          writeFileSync(join(profileDir, 'node_modules', 'pkg-bare', 'package.json'), JSON.stringify({ name: 'pkg-bare', version: '0.1.0', type: 'module', main: './index.js' }))
          writeFileSync(join(profileDir, 'node_modules', 'pkg-bare', 'index.js'), '')
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
            name: 'dsh-profile-t',
            private: true,
            dependencies,
            dsh: { profile: { bundles: manifestBundles(profileDir) } },
          }))
          rmSync(join(profileDir, 'node_modules', 'pkg-one'), { recursive: true, force: true })
        },
      }
    }
    const outcome = await pnpmUninstall(BIN, 'pkg-one', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toEqual({ ok: true, packageName: 'pkg-one', restartRequired: true })
    expect(manifestBundles(dir)).toEqual([])
    expect(existsSync(join(dir, 'node_modules', 'pkg-one'))).toBe(false)
  })

  it('refuses packages when the profile declares no dependencies at all', async () => {
    const dir = tempProfile()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-t', private: true }))
    const outcome = await pnpmUninstall(BIN, 'pkg-one', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toMatchObject({ ok: false, message: /not a dependency-managed plugin/ })
  })

  it('reports a timed-out remove as a failure', async () => {
    const dir = tempProfile()
    stageProfile(dir, { 'pkg-one': { bundle: true } }, ['pkg-one'])
    spawnControl.script = () => ({ code: 0, delayMs: 300 })
    const outcome = await pnpmUninstall(BIN, 'pkg-one', { ...OPTIONS_BASE, profileDir: dir, pnpmTimeoutMs: 20 })
    expect(outcome).toMatchObject({ ok: false, message: 'pnpm remove pkg-one timed out after 20ms' })
  })

  it('reports a spawn failure during remove', async () => {
    const dir = tempProfile()
    stageProfile(dir, { 'pkg-one': { bundle: true } }, ['pkg-one'])
    spawnControl.script = () => ({ code: null, error: Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' }) })
    const outcome = await pnpmUninstall(BIN, 'pkg-one', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toMatchObject({ ok: false, message: 'pnpm remove pkg-one failed with exit code spawn error' })
  })

  it('reports a failed remove with the captured output tail', async () => {
    const dir = tempProfile()
    stageProfile(dir, { 'pkg-one': { bundle: true } }, ['pkg-one'])
    spawnControl.script = () => ({ code: 1, stdout: 'remove went wrong\n' })
    const outcome = await pnpmUninstall(BIN, 'pkg-one', { ...OPTIONS_BASE, profileDir: dir })
    expect(outcome).toEqual({
      ok: false,
      message: 'pnpm remove pkg-one failed with exit code 1',
      outputTail: 'remove went wrong\n',
    })
  })
})
