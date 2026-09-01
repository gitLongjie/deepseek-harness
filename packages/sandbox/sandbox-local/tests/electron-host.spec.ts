/**
 * Windows-acl runner resolution inside an Electron embedding: the packaged
 * desktop app boots the runner through its own executable in Node mode
 * (`ELECTRON_RUN_AS_NODE`) against the unpacked on-disk entry, keeps the
 * plain-executable contract on ordinary hosts, and fails closed when no
 * loadable entry exists. The ACL service surface is mocked; native behavior
 * lives in sandbox-windows-acl's suites.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SANDBOX_UNAVAILABLE } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxInternals } from '@deepseek-ai/dsh-sandbox-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

vi.mock('@deepseek-ai/dsh-sandbox-windows-acl', () => ({
  AclWriteGrant: class {
    constructor(readonly workspace: string) {}
  },
  assertTempRootOutsideWorkspace: () => {},
  workspaceWriteSid: () => 'S-1-4-42-42',
  tempWriteSid: (path: string) => `TEMP:${path}`,
}))

/** Agentless read-only policy: no grant materialization, pure argv resolution. */
const RO: SandboxPolicy = { mode: 'read-only', workspaceRoot: tmpdir() }

async function setup(internals: SandboxInternals): Promise<LocalSandboxProvider> {
  const ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { platform: 'win32', ...internals }
  return sandbox
}

describe('windows-acl runner resolution inside an Electron embedding', () => {
  const scratch: string[] = []
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A fake packaged layout: the archive-resolved entry plus its unpacked twin, each as a real file. */
  function fakePackagedEntry(): { asarEntry: string; unpackedEntry: string } {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-host-'))
    scratch.push(root)
    const asarEntry = join(root, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js')
    const unpackedEntry = join(root, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js')
    mkdirSync(join(asarEntry, '..'), { recursive: true })
    mkdirSync(join(unpackedEntry, '..'), { recursive: true })
    writeFileSync(asarEntry, 'process.exit(0)')
    writeFileSync(unpackedEntry, 'process.exit(0)')
    return { asarEntry, unpackedEntry }
  }

  /** The same layout with the unpacked twin removed (the unpack step was skipped). */
  function fakePackagedEntryWithoutUnpackedTwin(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-host-'))
    scratch.push(root)
    const asarEntry = join(root, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js')
    mkdirSync(join(asarEntry, '..'), { recursive: true })
    writeFileSync(asarEntry, 'process.exit(0)')
    return asarEntry
  }

  it('runs the unpacked on-disk twin in Node mode when the resolved entry lives inside app.asar', async () => {
    const { asarEntry, unpackedEntry } = fakePackagedEntry()
    const sandbox = await setup({ electronHost: true, windowsAclRunnerEntry: asarEntry })
    const confined = sandbox.confine(['true'], RO)
    expect(confined.argv.slice(0, 2)).toEqual([process.execPath, unpackedEntry])
    expect(confined.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('fails closed when the asar entry has no unpacked on-disk twin', async () => {
    const asarEntry = fakePackagedEntryWithoutUnpackedTwin()
    const sandbox = await setup({ electronHost: true, windowsAclRunnerEntry: asarEntry })
    expect(() => sandbox.confine(['true'], RO)).toThrow(expect.objectContaining({ code: SANDBOX_UNAVAILABLE }))
  })

  it('runs an on-disk entry (open desktop checkout) in Node mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-host-disk-'))
    scratch.push(root)
    const builtEntry = join(root, 'runner.js')
    writeFileSync(builtEntry, 'process.exit(0)')
    const sandbox = await setup({ electronHost: true, windowsAclRunnerEntry: builtEntry })
    const confined = sandbox.confine(['true'], RO)
    expect(confined.argv.slice(0, 2)).toEqual([process.execPath, builtEntry])
    expect(confined.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('a plain Node host (CLI, source development) keeps the executable contract with no runner environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-host-node-'))
    scratch.push(root)
    const builtEntry = join(root, 'runner.js')
    writeFileSync(builtEntry, 'process.exit(0)')
    const sandbox = await setup({ windowsAclRunnerEntry: builtEntry })
    const confined = sandbox.confine(['true'], RO)
    expect(confined.argv.slice(0, 2)).toEqual([process.execPath, builtEntry])
    expect(confined.env).toBeUndefined()
  })

  it('the operator argv override stays untouched and injects no environment', async () => {
    const sandbox = await setup({ electronHost: true, windowsAclRunnerArgs: ['fake-runner', '--flag'] })
    const confined = sandbox.confine(['true'], RO)
    expect(confined.argv.slice(0, 2)).toEqual(['fake-runner', '--flag'])
    expect(confined.env).toBeUndefined()
  })

  it('the real default probe carries the Node-mode environment', async () => {
    // The fake entry exits 0, so the probe selects the rung — this covers the
    // probe's environment merge; the real runner's behavior is the native
    // suites' subject.
    const { asarEntry, unpackedEntry } = fakePackagedEntry()
    const sandbox = await setup({
      chain: ['windows-acl', 'bwrap'],
      probeBwrap: () => false,
      electronHost: true,
      windowsAclRunnerEntry: asarEntry,
    })
    const confined = sandbox.confine(['true'], RO)
    expect(confined.argv.slice(0, 2)).toEqual([process.execPath, unpackedEntry])
    expect(confined.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  }, 15_000)
})
