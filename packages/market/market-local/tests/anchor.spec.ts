import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The candidate chain comes from createRequire(from).resolve.paths, whose tail
// includes host-wide global paths (a pnpm checkout leaks its virtual store
// through NODE_PATH). Pin the whole chain so every assertion is hermetic.
const chainRoots: string[][] = []

vi.mock('node:module', () => ({
  createRequire: () => ({
    resolve: {
      paths: (): string[] | undefined => chainRoots.at(-1),
    },
  }),
}))

afterEach(() => { chainRoots.pop() })

function stageNodeModules(dir: string, name: string): string {
  const packageDir = join(dir, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name }), 'utf8')
  return join(packageDir, 'package.json')
}

describe('resolveInstallAnchor', () => {
  it('prefers the nearest candidate that carries the dsh package name', async () => {
    const { resolveInstallAnchor } = await import('../src/anchor.ts')
    const root = mkdtempSync(join(tmpdir(), 'dsh-market-anchor-'))
    const wrong = stageNodeModules(join(root, 'first'), '@deepseek-ai/dsh-root')
    const right = stageNodeModules(join(root, 'second'), '@deepseek-ai/dsh')
    // resolve.paths candidates are node_modules directories themselves.
    chainRoots.push([join(root, 'first', 'node_modules'), join(root, 'second', 'node_modules')])
    expect(resolveInstallAnchor(import.meta.url)).toBe(right)
    expect(right).not.toBe(wrong)
  })

  it('throws when no candidate carries the dsh package', async () => {
    const { resolveInstallAnchor } = await import('../src/anchor.ts')
    const root = mkdtempSync(join(tmpdir(), 'dsh-market-anchor-'))
    stageNodeModules(join(root, 'first'), '@deepseek-ai/dsh-root')
    chainRoots.push([join(root, 'first', 'node_modules'), join(root, 'missing', 'node_modules')])
    expect(() => resolveInstallAnchor(import.meta.url)).toThrow(/cannot resolve the running dsh installation/)
  })

  it('throws when the resolution chain is empty', async () => {
    const { resolveInstallAnchor } = await import('../src/anchor.ts')
    chainRoots.push([])
    expect(() => resolveInstallAnchor(import.meta.url)).toThrow(/cannot resolve the running dsh installation/)
  })

  it('throws when the resolver provides no candidate paths', async () => {
    const { resolveInstallAnchor } = await import('../src/anchor.ts')
    expect(() => resolveInstallAnchor(import.meta.url)).toThrow(/cannot resolve the running dsh installation/)
  })
})
