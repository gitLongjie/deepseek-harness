/**
 * Windows backslash asar paths must reach the unpacked twin too: the packaged
 * host resolves `@vscode/ripgrep` through Node's backslash separators, and the
 * rewrite used to match forward slashes only, spawning the unspawnable
 * archive path (`ENOENT`) on every Windows install.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@vscode/ripgrep', () => ({
  rgPath: 'resources\\app.asar\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe',
}))

describe('ripgrep resolution from a Windows backslash asar path', () => {
  it('rewrites the backslash asar path to the unpacked twin', async () => {
    const { resolveRgPath } = await import('../src/index.ts')
    await expect(resolveRgPath()).resolves.toBe(
      'resources\\app.asar.unpacked\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe',
    )
  })
})
