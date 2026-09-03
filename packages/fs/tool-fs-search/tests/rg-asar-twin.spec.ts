/** Ripgrep resolution must spawn the unpacked twin of an asar-resolved binary. */
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const asarRgPath = join('resources', 'app.asar', 'node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg')
const twinRgPath = join('resources', 'app.asar.unpacked', 'node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg')

vi.mock('@vscode/ripgrep', () => ({ rgPath: asarRgPath }))

describe('ripgrep resolution inside an asar archive', () => {
  it('spawns the unpacked twin of the archive-resolved binary', async () => {
    const { resolveRgPath } = await import('../src/index.ts')
    await expect(resolveRgPath()).resolves.toBe(twinRgPath)
  })
})
