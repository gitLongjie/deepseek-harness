/**
 * The project asset library: characters, scenes, and props confirmed once and reused by every
 * later plan in the same output directory. A record carries the reference image, the character
 * master sheet, and the canonical prompt block, so a new episode attaches the same settings
 * instead of redefining them.
 * @module @deepseek-ai/dsh-tool-video/library
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PlanAsset } from './types.ts'

/** One library record: the plan asset plus when it was last written. */
export interface LibraryAsset extends PlanAsset {
  /** Epoch ms of the last upsert. */
  readonly updatedAt: number
}

/** The persisted library document. */
interface LibraryDocument {
  readonly version: 1
  readonly assets: readonly LibraryAsset[]
}

const LIBRARY_VERSION = 1

/**
 * Path of the library document under one output directory.
 * @param outputDir - the h3-video output directory.
 * @returns the absolute library path.
 */
export function libraryPath(outputDir: string): string {
  return join(outputDir, 'assets', 'library.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLibraryAsset(value: unknown): value is LibraryAsset {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (value.kind === 'character' || value.kind === 'scene' || value.kind === 'prop')
    && typeof value.updatedAt === 'number'
}

/**
 * Read the project's saved assets. A missing document is an empty library.
 * @param outputDir - the h3-video output directory.
 * @returns the saved records.
 * @throws Error - naming the file when the document is corrupt.
 */
export async function readLibrary(outputDir: string): Promise<readonly LibraryAsset[]> {
  const file = libraryPath(outputDir)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<LibraryDocument>
  if (!Array.isArray(parsed.assets) || !parsed.assets.every(isLibraryAsset)) {
    throw new Error(`asset library ${file} is corrupt`)
  }
  return parsed.assets
}

/**
 * Upsert assets into the project library, keyed by name — the name the storyboard references.
 * @param outputDir - the h3-video output directory.
 * @param assets - the assets to save; empty input writes nothing.
 */
export async function saveLibraryAssets(outputDir: string, assets: readonly PlanAsset[]): Promise<void> {
  if (assets.length === 0) return
  const merged = new Map((await readLibrary(outputDir)).map(asset => [asset.name, asset]))
  const updatedAt = Date.now()
  for (const asset of assets) merged.set(asset.name, { ...asset, updatedAt })
  const file = libraryPath(outputDir)
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, `${JSON.stringify({ version: LIBRARY_VERSION, assets: [...merged.values()] }, null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/**
 * Find one saved asset by the name or id a plan asked for.
 * @param assets - the saved records.
 * @param reference - asset name or id.
 * @returns the record, or `undefined` when the library has no such asset.
 */
export function findLibraryAsset(assets: readonly LibraryAsset[], reference: string): LibraryAsset | undefined {
  return assets.find(asset => asset.name === reference || asset.id === reference)
}
