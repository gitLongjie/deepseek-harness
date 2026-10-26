/**
 * Recoverable workbench deletions. Images referenced by another plan or the asset library stay
 * in place; a failed move or plan write restores the files already moved by that operation.
 * @module @deepseek-ai/dsh-video-workbench/trash
 */

import { mkdir, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveWorkbenchFile } from './file-serve.ts'

/** Outcome of one deletion: what moved, and where it went. */
export interface TrashResult {
  /** Directory the files were moved into. */
  readonly trashDir: string
  /** Moved file names relative to the projection root, in discovery order. */
  readonly files: readonly string[]
}

const PLAN_ID = /^vp-\d+$/u
const ASSET_ID = /^[A-Za-z0-9_.-]+$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function readDocument(file: string): Promise<Record<string, unknown> | undefined> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value)) throw new Error(`invalid video document: ${file}`)
  if (value.assets !== undefined && (!Array.isArray(value.assets) || !value.assets.every(isRecord))) {
    throw new Error(`invalid video assets: ${file}`)
  }
  if (value.segments !== undefined && (!Array.isArray(value.segments) || !value.segments.every(isRecord))) {
    throw new Error(`invalid video segments: ${file}`)
  }
  return value
}

async function localFile(outputDir: string, value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const absolute = isAbsolute(value) ? value : resolve(outputDir, value)
  const distance = relative(outputDir, absolute).split(sep).join('/')
  const result = await resolveWorkbenchFile(outputDir, distance)
  return 'reason' in result ? undefined : result.path
}

async function assetFiles(outputDir: string, assets: unknown): Promise<string[]> {
  const files = new Set<string>()
  if (!Array.isArray(assets)) return []
  for (const asset of assets) {
    if (!isRecord(asset)) continue
    for (const value of [asset.reference, asset.sheet]) {
      const file = await localFile(outputDir, value)
      if (file !== undefined) files.add(file)
    }
  }
  return [...files]
}

async function segmentFiles(outputDir: string, segments: unknown): Promise<string[]> {
  const files = new Set<string>()
  if (!Array.isArray(segments)) return []
  for (const segment of segments) {
    if (!isRecord(segment) || segment.references === undefined) continue
    if (!Array.isArray(segment.references) || !segment.references.every(isRecord)) {
      throw new Error('invalid video segment references')
    }
    for (const reference of segment.references) {
      const file = await localFile(outputDir, reference.source)
      if (file !== undefined) files.add(file)
    }
  }
  return [...files]
}

/** A corrupt referring document blocks deletion because its image references are unknown. */
async function retainedFiles(
  outputDir: string,
  excludedPlan: string,
  remainingAssets: unknown = [],
  remainingSegments: unknown = [],
): Promise<ReadonlySet<string>> {
  const files = new Set(await assetFiles(outputDir, remainingAssets))
  for (const file of await segmentFiles(outputDir, remainingSegments)) files.add(file)
  const library = await readDocument(join(outputDir, 'assets', 'library.json'))
  for (const file of await assetFiles(outputDir, library?.assets)) files.add(file)
  for (const name of await listDir(join(outputDir, 'plans'))) {
    if (!name.endsWith('.json') || name === `${excludedPlan}.json`) continue
    const plan = await readDocument(join(outputDir, 'plans', name))
    for (const file of await assetFiles(outputDir, plan?.assets)) files.add(file)
    for (const file of await segmentFiles(outputDir, plan?.segments)) files.add(file)
  }
  return files
}

async function trashFiles(
  outputDir: string,
  label: string,
  candidates: readonly string[],
  retained: ReadonlySet<string>,
  commit?: (trashDir: string) => Promise<void>,
): Promise<TrashResult> {
  const trashRoot = join(dirname(resolve(outputDir)), TRASH_DIRECTORY)
  await mkdir(trashRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const trashDir = await mkdtemp(join(trashRoot, `${stamp}-${label}-`))
  const moved: Array<{ source: string; destination: string; name: string }> = []
  try {
    for (const candidate of new Set(candidates)) {
      const source = await localFile(outputDir, candidate)
      if (source === undefined || retained.has(source)) continue
      // Keep the requested directory layout even when the output root itself is a symlink.
      const name = relative(outputDir, candidate)
      const destination = join(trashDir, name)
      await mkdir(dirname(destination), { recursive: true })
      await rename(candidate, destination)
      moved.push({ source: candidate, destination, name })
    }
    await commit?.(trashDir)
  } catch (error: unknown) {
    const failures: unknown[] = [error]
    for (const file of moved.reverse()) {
      try {
        await rename(file.destination, file.source)
      } catch (restoreError: unknown) {
        failures.push(restoreError)
      }
    }
    if (failures.length > 1) throw new AggregateError(failures, `video deletion rollback failed; inspect ${trashDir}`)
    throw error
  }
  return { trashDir, files: moved.map(file => file.name) }
}

/**
 * Trash a project's artifacts while retaining images referenced by another plan or the library.
 * @param outputDir - projection root.
 * @param planId - project id (`vp-<n>`).
 * @returns the recovery directory and moved names.
 * @throws Error - for invalid ids, unreadable referring documents, or failed filesystem writes.
 */
export async function deleteProject(outputDir: string, planId: string): Promise<TrashResult> {
  if (!PLAN_ID.test(planId)) throw new Error(`not a project id: ${JSON.stringify(planId)}`)
  const retained = await retainedFiles(outputDir, planId)
  const candidates = [join(outputDir, 'final', `${planId}.mp4`)]
  for (const directory of ['segments', 'keyframes', 'assets']) {
    for (const entry of await listDir(join(outputDir, directory))) {
      if (entry.startsWith(`${planId}-`)) candidates.push(join(outputDir, directory, entry))
    }
  }
  candidates.push(join(outputDir, 'plans', `${planId}.json`))
  return await trashFiles(outputDir, planId, candidates, retained)
}

/**
 * Detach an asset and trash only its unshared images. Library records remain reusable.
 * @param outputDir - projection root.
 * @param planId - owning project id.
 * @param assetId - asset to detach.
 * @returns the recovery directory and moved names.
 * @throws Error - for invalid ids, absent assets, unreadable documents, or failed writes.
 */
export async function deleteAsset(outputDir: string, planId: string, assetId: string): Promise<TrashResult> {
  if (!PLAN_ID.test(planId)) throw new Error(`not a project id: ${JSON.stringify(planId)}`)
  if (!ASSET_ID.test(assetId)) throw new Error(`not an asset id: ${JSON.stringify(assetId)}`)
  const planFile = join(outputDir, 'plans', `${planId}.json`)
  const plan = await readDocument(planFile)
  const assets = plan?.assets as Array<Record<string, unknown>> | undefined ?? []
  const removed = assets.filter(asset => asset.id === assetId)
  if (plan === undefined || removed.length === 0) {
    throw new Error(`plan ${planId} has no asset ${JSON.stringify(assetId)}`)
  }
  const remaining = assets.filter(asset => asset.id !== assetId)
  const retained = await retainedFiles(outputDir, planId, remaining, plan.segments)
  const candidates = await assetFiles(outputDir, removed)
  return await trashFiles(outputDir, `${planId}-${assetId}`, candidates, retained, async (trashDir) => {
    const backup = join(trashDir, 'plans', `${planId}.json`)
    await mkdir(dirname(backup), { recursive: true })
    await writeFile(backup, await readFile(planFile))
    const tmp = `${planFile}.tmp`
    await writeFile(tmp, `${JSON.stringify({ ...plan, assets: remaining }, null, 2)}\n`, 'utf8')
    await rename(tmp, planFile)
  })
}

/** Recovery directory beside the projected output root. */
export const TRASH_DIRECTORY = 'video-trash'
