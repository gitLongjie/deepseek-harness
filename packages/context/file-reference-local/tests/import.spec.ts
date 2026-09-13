import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_IMPORTS_DIRECTORY,
  DEFAULT_MAX_IMPORT_BYTES,
  importFile,
  validateImportConfig,
} from '../src/index.ts'

const roots: string[] = []
const POLICY = { maxImportBytes: 64, importsDirectory: DEFAULT_IMPORTS_DIRECTORY }
const SIGNAL = new AbortController().signal
/** 'xyz' repeated: padding-free canonical base64, 3 bytes per group. */
const XYZ = 'eHl6'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One fresh workspace root, optionally pre-seeding named files under uploads/. */
async function workspace(seeded: readonly string[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-import-'))
  roots.push(root)
  if (seeded.length > 0) {
    await mkdir(join(root, DEFAULT_IMPORTS_DIRECTORY), { recursive: true })
    await Promise.all(seeded.map(name => writeFile(join(root, DEFAULT_IMPORTS_DIRECTORY, name), 'seeded')))
  }
  return root
}

/** Rejections that fire before admission must not even create the imports directory. */
async function uploadsExists(root: string): Promise<boolean> {
  return stat(join(root, DEFAULT_IMPORTS_DIRECTORY)).then(() => true, () => false)
}

describe('importFile', () => {
  it('stores the decoded bytes under the imports directory and reports a forward-slash path', async () => {
    const root = await workspace()
    const stored = await importFile(root, POLICY, { name: 'notes.txt', data: 'aGVsbG8=' }, SIGNAL)
    expect(stored).toEqual({ path: `${DEFAULT_IMPORTS_DIRECTORY}/notes.txt` })
    await expect(readFile(join(root, DEFAULT_IMPORTS_DIRECTORY, 'notes.txt'), 'utf8')).resolves.toBe('hello')
    // One-byte payload with double padding decodes exactly one byte.
    const tiny = await importFile(root, POLICY, { name: 'tiny.bin', data: 'YQ==' }, SIGNAL)
    expect(tiny.path).toBe(`${DEFAULT_IMPORTS_DIRECTORY}/tiny.bin`)
    await expect(readFile(join(root, DEFAULT_IMPORTS_DIRECTORY, 'tiny.bin'), 'utf8')).resolves.toBe('a')
  })

  it('never overwrites: same-name imports receive -N suffixes', async () => {
    const root = await workspace(['report.pdf'])
    const first = await importFile(root, POLICY, { name: 'report.pdf', data: 'aGVsbG8=' }, SIGNAL)
    expect(first.path).toBe(`${DEFAULT_IMPORTS_DIRECTORY}/report-1.pdf`)
    const second = await importFile(root, POLICY, { name: 'report.pdf', data: 'aGVsbG8=' }, SIGNAL)
    expect(second.path).toBe(`${DEFAULT_IMPORTS_DIRECTORY}/report-2.pdf`)
  })

  it('stores extensionless names beside dotted ones', async () => {
    const root = await workspace(['Makefile'])
    const stored = await importFile(root, POLICY, { name: 'Makefile', data: 'aGVsbG8=' }, SIGNAL)
    expect(stored.path).toBe(`${DEFAULT_IMPORTS_DIRECTORY}/Makefile-1`)
  })

  it('treats a non-file occupant of the proposed name as a collision', async () => {
    const root = await workspace()
    // A directory occupying the proposed name registers as EEXIST for a wx
    // open, so the probe moves sideways instead of failing or overwriting.
    await mkdir(join(root, DEFAULT_IMPORTS_DIRECTORY, 'blocked.txt'), { recursive: true })
    const stored = await importFile(root, POLICY, { name: 'blocked.txt', data: 'aGVsbG8=' }, SIGNAL)
    expect(stored.path).toBe(`${DEFAULT_IMPORTS_DIRECTORY}/blocked-1.txt`)
  })

  it('rejects path separators, forbidden characters, and empty names before writing', async () => {
    const root = await workspace()
    await expect(importFile(root, POLICY, { name: '../escape.txt', data: 'aGVsbG8=' }, SIGNAL))
      .rejects.toThrow(/bare file name/)
    await expect(importFile(root, POLICY, { name: 'a\\b.txt', data: 'aGVsbG8=' }, SIGNAL))
      .rejects.toThrow(/bare file name/)
    await expect(importFile(root, POLICY, { name: 'a:b.txt', data: 'aGVsbG8=' }, SIGNAL))
      .rejects.toThrow(/bare file name/)
    await expect(importFile(root, POLICY, { name: '', data: 'aGVsbG8=' }, SIGNAL))
      .rejects.toThrow(/bare file name/)
    // A name of dots alone reduces to nothing after the trailing-dot strip.
    await expect(importFile(root, POLICY, { name: '..', data: 'aGVsbG8=' }, SIGNAL))
      .rejects.toThrow(/empty or too long/)
    await expect(importFile(root, POLICY, { name: 'x'.repeat(201), data: 'aGVsbG8=' }, SIGNAL))
      .rejects.toThrow(/empty or too long/)
    expect(await uploadsExists(root)).toBe(false)
  })

  it('stores Windows-reserved device names under an underscore prefix', async () => {
    const root = await workspace()
    const reserved = await importFile(root, POLICY, { name: 'con.txt', data: 'aGVsbG8=' }, SIGNAL)
    expect(reserved.path).toBe(`${DEFAULT_IMPORTS_DIRECTORY}/_con.txt`)
  })

  it('rejects non-canonical base64, empty payloads, and over-limit sizes before writing', async () => {
    const root = await workspace()
    await expect(importFile(root, POLICY, { name: 'a.txt', data: 'not!!base' }, SIGNAL))
      .rejects.toThrow(/canonical base64/)
    await expect(importFile(root, POLICY, { name: 'a.txt', data: 'aGVsbG' }, SIGNAL))
      .rejects.toThrow(/canonical base64/)
    await expect(importFile(root, POLICY, { name: 'a.txt', data: '' }, SIGNAL))
      .rejects.toThrow(/non-empty/)
    // 24 padding-free groups decode to 72 bytes, over the 64-byte policy.
    await expect(importFile(root, POLICY, { name: 'a.txt', data: XYZ.repeat(24) }, SIGNAL))
      .rejects.toThrow(/byte limit/)
    expect(await uploadsExists(root)).toBe(false)
  })

  it('aborts before writing when the caller signal is already dead', async () => {
    const root = await workspace()
    const controller = new AbortController()
    controller.abort()
    await expect(importFile(root, POLICY, { name: 'gone.bin', data: 'aGVsbG8=' }, controller.signal))
      .rejects.toThrow()
    expect(await uploadsExists(root)).toBe(false)
  })

  it('removes the partial copy when the write aborts mid-flight', async () => {
    const root = await workspace()
    const controller = new AbortController()
    // The abort fires while importFile awaits the directory creation, so the
    // write below starts against a dead signal and its guard removes the copy.
    queueMicrotask(() => { controller.abort() })
    await expect(importFile(root, POLICY, { name: 'gone.bin', data: 'aGVsbG8=' }, controller.signal))
      .rejects.toThrow()
    expect(await readdir(join(root, DEFAULT_IMPORTS_DIRECTORY))).toEqual([])
  })

  it('exhausting the collision probes fails instead of overwriting', async () => {
    const seeded: string[] = ['dup.txt']
    for (let n = 1; n < 100; n += 1) seeded.push(`dup-${n}.txt`)
    const root = await workspace(seeded)
    await expect(importFile(root, POLICY, { name: 'dup.txt', data: 'aGVsbG8=' }, SIGNAL))
      .rejects.toThrow(/free name/)
  })
})

describe('validateImportConfig', () => {
  it('accepts the default policy', () => {
    expect(() => validateImportConfig({ maxImportBytes: DEFAULT_MAX_IMPORT_BYTES, importsDirectory: 'uploads' }))
      .not.toThrow()
  })

  it('rejects non-positive byte limits and unsafe directories', () => {
    expect(() => validateImportConfig({ maxImportBytes: 0, importsDirectory: 'uploads' })).toThrow(/maxImportBytes/)
    expect(() => validateImportConfig({ maxImportBytes: 1.5, importsDirectory: 'uploads' })).toThrow(/maxImportBytes/)
    expect(() => validateImportConfig({ maxImportBytes: 1, importsDirectory: '' })).toThrow(/importsDirectory/)
    expect(() => validateImportConfig({ maxImportBytes: 1, importsDirectory: '..' })).toThrow(/importsDirectory/)
    expect(() => validateImportConfig({ maxImportBytes: 1, importsDirectory: 'a/b' })).toThrow(/importsDirectory/)
    expect(() => validateImportConfig({ maxImportBytes: 1, importsDirectory: 'a\\b' })).toThrow(/importsDirectory/)
  })
})
