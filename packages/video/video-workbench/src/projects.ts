/**
 * Project discovery for the video workbench: reads the plan artifacts the tool-video pipeline
 * writes and reports, per project, what has actually landed on disk. The directory is the only
 * source of truth — nothing here writes, and a corrupt plan becomes one error row instead of
 * failing the whole listing.
 * @module @deepseek-ai/dsh-video-workbench/projects
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { resolveWorkbenchFile } from './file-serve.ts'

/** Extensions the hosted image model can return; keyframe artifacts carry any of them. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.webp'] as const

/** Asset kinds the pipeline records; anything else is ignored rather than projected. */
const ASSET_KINDS: ReadonlySet<string> = new Set(['character', 'scene', 'prop'])

/** One plan asset as the workbench projects it. */
export interface WorkbenchAssetRow {
  /** Stable asset id from the plan. */
  readonly id: string
  /** Name the storyboard references. */
  readonly name: string
  /** `character`, `scene`, or `prop`. */
  readonly kind: string
  /** Canonical prompt block the pipeline copies into every generation prompt. */
  readonly prompt?: string
  /** Short human-facing description, present when the plan carries no prompt block. */
  readonly description?: string
  /** Served reference image path inside the projected directory. */
  readonly reference?: string
  /** Served legacy character master-sheet path inside the projected directory, when an old plan has one. */
  readonly sheet?: string
  /** Whether the project asset library carries an asset of this name. */
  readonly saved: boolean
}

/** One rendered-shot row of a project summary. */
export interface WorkbenchSegmentRow {
  /** Plan segment id (the synthetic `all` id for a multi-shot render). */
  readonly id: string
  /** Whether the canonical segment mp4 exists. */
  readonly rendered: boolean
  /** The shot prompt the render actually uses, so a regeneration can start from it. */
  readonly prompt: string
  /** Authored shots represented by this render task, in storyboard order. */
  readonly shots: readonly WorkbenchShot[]
  /** Absolute keyframe path when one exists for this segment. */
  readonly keyframe?: string
  /** Absolute rendered mp4 path when the segment is rendered, so the page can play it alone. */
  readonly file?: string
}

/** Authored storyboard information retained independently of the render task grouping. */
export interface WorkbenchShot {
  /** Authored shot id, including when several shots render as `all`. */
  readonly id: string
  /** Original shot description. */
  readonly prompt: string
  /** Camera direction when recorded. */
  readonly camera?: string
  /** Recorded relation to the previous shot. */
  readonly continuity?: string
  /** Recorded starting state, event, and ending state for continuity review. */
  readonly startState?: string
  readonly event?: string
  readonly endState?: string
  /** Exact assets selected by the storyboard. */
  readonly assetIds?: readonly string[]
  /** Shot length in seconds when recorded. */
  readonly durationSeconds?: number
  /** Recorded resolution tier. */
  readonly resolution?: string
  /** Recorded aspect ratio. */
  readonly ratio?: string
  /** Recorded routing policy. */
  readonly backend?: string
}

/** One video project as the workbench projects it. */
export interface WorkbenchProject {
  /** Plan id, e.g. `vp-3`. */
  readonly id: string
  /** Plan revision number. */
  readonly revision: number
  /** One-line goal the plan serves. */
  readonly goal: string
  /** Render mode (`multi_shot` or `per_segment`). */
  readonly mode: string
  /** Plan creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Shot rows with their on-disk state. */
  readonly segments: readonly WorkbenchSegmentRow[]
  /** Absolute completed mp4 path: the combined clip or the per-segment assembly. */
  readonly final?: string
  /** Bytes of the completed video, when present. */
  readonly finalBytes?: number
  /** Recorded cast/set/prop anchors, in plan order. */
  readonly assets: readonly WorkbenchAssetRow[]
}

/** The whole listing the workbench page renders. */
export interface WorkbenchSummary {
  /** Absolute projected directory. */
  readonly outputDir: string
  /** Projects, newest plan first. */
  readonly projects: readonly WorkbenchProject[]
  /** One message per unreadable or corrupt plan file. */
  readonly errors: readonly string[]
}

/** The plan fields the projection reads; extra fields are ignored, not validated. */
interface PlanFile {
  id?: unknown
  revision?: unknown
  goal?: unknown
  mode?: unknown
  createdAt?: unknown
  segments?: unknown
  assets?: unknown
}

interface PlanSegment {
  id?: unknown
  prompt?: unknown
  camera?: unknown
  continuity?: unknown
  startState?: unknown
  event?: unknown
  endState?: unknown
  assetIds?: unknown
  durationSeconds?: unknown
  resolution?: unknown
  ratio?: unknown
  backend?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function projectShot(segment: PlanSegment & { id: string }): WorkbenchShot {
  return {
    id: segment.id,
    prompt: typeof segment.prompt === 'string' ? segment.prompt : '',
    ...(typeof segment.camera === 'string' ? { camera: segment.camera } : {}),
    ...(typeof segment.continuity === 'string' ? { continuity: segment.continuity } : {}),
    ...(typeof segment.startState === 'string' ? { startState: segment.startState } : {}),
    ...(typeof segment.event === 'string' ? { event: segment.event } : {}),
    ...(typeof segment.endState === 'string' ? { endState: segment.endState } : {}),
    ...(Array.isArray(segment.assetIds) && segment.assetIds.every((id: unknown) => typeof id === 'string')
      ? { assetIds: segment.assetIds } : {}),
    ...(typeof segment.durationSeconds === 'number' && Number.isFinite(segment.durationSeconds)
      ? { durationSeconds: segment.durationSeconds } : {}),
    ...(typeof segment.resolution === 'string' ? { resolution: segment.resolution } : {}),
    ...(typeof segment.ratio === 'string' ? { ratio: segment.ratio } : {}),
    ...(typeof segment.backend === 'string' ? { backend: segment.backend } : {}),
  }
}

/** One recorded asset as the plan file carries it. */
interface PlanAssetFile {
  id?: unknown
  name?: unknown
  kind?: unknown
  prompt?: unknown
  description?: unknown
  reference?: unknown
  sheet?: unknown
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const file = await stat(path)
    return file.isFile() ? file.size : undefined
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

/**
 * Locate a generated image artifact by probing the extensions the image endpoint can return.
 * @param keyframesDir - the plan's keyframes directory.
 * @param planId - owning plan id.
 * @param segmentId - segment id.
 * @returns the absolute path, or undefined when no keyframe was written.
 */
export async function findKeyframe(
  keyframesDir: string,
  planId: string,
  segmentId: string,
): Promise<string | undefined> {
  for (const extension of IMAGE_EXTENSIONS) {
    const candidate = join(keyframesDir, `${planId}-${segmentId}${extension}`)
    if (await exists(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve one plan asset image to a path the file route can serve. The value must name a file
 * inside the projected directory — absolute or directory-relative — with a servable extension;
 * anything else is dropped rather than projected as a dead image.
 * @param outputDir - the projected output directory.
 * @param value - the plan's reference or sheet value.
 * @returns the real path when the file exists inside the directory, else undefined.
 */
async function servedAssetPath(outputDir: string, value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const absolute = isAbsolute(value) ? value : join(outputDir, value)
  const distance = relative(outputDir, absolute)
  if (distance.length === 0) return undefined
  // The file resolver re-checks that the joined path stays inside the directory, so a `..` hop or
  // a drive-qualified value outside it is refused there and dropped here.
  const resolved = await resolveWorkbenchFile(outputDir, distance.split(sep).join('/'))
  return 'reason' in resolved ? undefined : resolved.path
}

/**
 * Names the project asset library carries. A missing or corrupt library reads as empty: this is a
 * read-only projection of rendering state, and a broken library must not hide the projects.
 * @param outputDir - the projected output directory.
 * @returns the saved asset names.
 */
async function savedAssetNames(outputDir: string): Promise<ReadonlySet<string>> {
  let raw: string
  try {
    raw = await readFile(join(outputDir, 'assets', 'library.json'), 'utf8')
  } catch {
    // No library yet: nothing has been recorded.
    return new Set()
  }
  try {
    const parsed = JSON.parse(raw) as { assets?: unknown }
    if (!Array.isArray(parsed.assets)) return new Set()
    const names = new Set<string>()
    for (const entry of parsed.assets) {
      if (typeof entry !== 'object' || entry === null) continue
      const name = (entry as { name?: unknown }).name
      if (typeof name === 'string' && name.length > 0) names.add(name)
    }
    return names
  } catch {
    // A corrupt document is the asset pipeline's failure to report, not this projection's.
    return new Set()
  }
}

/**
 * Project one plan's recorded assets in plan order, keeping only the images this route can serve
 * and marking each asset whose name the project library carries.
 * @param outputDir - the projected output directory.
 * @param raw - the plan's `assets` value.
 * @param saved - names the project asset library carries.
 * @returns the projected asset rows.
 */
async function projectAssets(
  outputDir: string,
  raw: unknown,
  saved: ReadonlySet<string>,
): Promise<WorkbenchAssetRow[]> {
  if (!Array.isArray(raw)) return []
  const rows: WorkbenchAssetRow[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const asset = entry as PlanAssetFile
    if (
      typeof asset.id !== 'string'
      || typeof asset.name !== 'string'
      || typeof asset.kind !== 'string'
      || !ASSET_KINDS.has(asset.kind)
    ) {
      continue
    }
    const reference = await servedAssetPath(outputDir, asset.reference)
    const sheet = await servedAssetPath(outputDir, asset.sheet)
    const prompt = typeof asset.prompt === 'string' && asset.prompt.trim().length > 0 ? asset.prompt : undefined
    const description = typeof asset.description === 'string' && asset.description.trim().length > 0
      ? asset.description
      : undefined
    rows.push({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(reference !== undefined ? { reference } : {}),
      ...(sheet !== undefined ? { sheet } : {}),
      saved: saved.has(asset.name),
    })
  }
  return rows
}

/**
 * Scan one output directory into a workbench listing. A `plans` entry that is not valid JSON or
 * misses its identity fields becomes one `errors` row; the rest of the listing still renders.
 * @param outputDir - the h3-video output directory holding `plans/`, `segments/`, `keyframes/`,
 *   `final/`, and `assets/`.
 * @returns the summary for the workbench page.
 */
export async function scanProjects(outputDir: string): Promise<WorkbenchSummary> {
  const errors: string[] = []
  const plansDir = join(outputDir, 'plans')
  const segmentsDir = join(outputDir, 'segments')
  const keyframesDir = join(outputDir, 'keyframes')
  const finalsDir = join(outputDir, 'final')
  let planFiles: string[] = []
  try {
    planFiles = (await readdir(plansDir)).filter(name => name.endsWith('.json'))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { outputDir, projects: [], errors }
  }
  const saved = await savedAssetNames(outputDir)
  const projects: WorkbenchProject[] = []
  for (const name of planFiles) {
    const file = join(plansDir, name)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    } catch (error: unknown) {
      errors.push(`plan ${name}: unreadable (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (!isRecord(parsed) || parsed.id !== name.slice(0, -'.json'.length) || !Array.isArray(parsed.segments)
      || !parsed.segments.every(entry => isRecord(entry) && typeof entry.id === 'string'
        && /^[A-Za-z0-9_-]+$/u.test(entry.id))) {
      errors.push(`plan ${name}: corrupt (id mismatch or segments missing)`)
      continue
    }
    const plan: PlanFile & { id: string; segments: Array<PlanSegment & { id: string }> } = {
      ...parsed,
      id: parsed.id,
      segments: parsed.segments as Array<PlanSegment & { id: string }>,
    }
    const planId = plan.id
    const mode = plan.mode === 'per_segment' ? 'per_segment' : 'multi_shot'
    const shots = plan.segments.map(projectShot)
    const segments: WorkbenchSegmentRow[] = []
    for (const shot of shots) {
      const segmentId = shot.id
      const prompt = shot.prompt
      const rendered = await exists(join(segmentsDir, `${planId}-${segmentId}.mp4`))
      const keyframe = await findKeyframe(keyframesDir, planId, segmentId)
      segments.push({
        id: segmentId,
        prompt,
        shots: [shot],
        ...keyframe !== undefined ? { keyframe } : {},
        ...rendered ? { file: join(segmentsDir, `${planId}-${segmentId}.mp4`) } : {},
        rendered,
      })
    }
    if (mode === 'multi_shot') {
      // The whole storyboard renders as one task under the synthetic `all` id; the keyframe
      // artifact, when one exists, was generated for the first shot.
      const rendered = await exists(join(segmentsDir, `${planId}-all.mp4`))
      const keyframe = segments[0]?.keyframe
      segments.length = 0
      segments.push({
        id: 'all',
        rendered,
        shots,
        // The whole storyboard renders as one task from the composite prompt.
        prompt: [typeof plan.goal === 'string' ? plan.goal : '', ...shots.map(shot => [
          shot.prompt,
          ...(shot.continuity !== undefined ? [`Continuity: ${shot.continuity}`] : []),
          ...(shot.startState !== undefined ? [`Start state: ${shot.startState}`] : []),
          ...(shot.event !== undefined ? [`Event: ${shot.event}`] : []),
          ...(shot.endState !== undefined ? [`End state: ${shot.endState}`] : []),
          ...(shot.assetIds !== undefined ? [`Asset ids: ${shot.assetIds.join(', ')}`] : []),
        ].join('\n'))]
          .filter(part => part.length > 0)
          .join('\n'),
        ...keyframe !== undefined ? { keyframe } : {},
        ...rendered ? { file: join(segmentsDir, `${planId}-all.mp4`) } : {},
      })
    }
    const final = mode === 'multi_shot'
      ? join(segmentsDir, `${planId}-all.mp4`)
      : join(finalsDir, `${planId}.mp4`)
    const finalBytes = await fileSize(final)
    const assets = await projectAssets(outputDir, plan.assets, saved)
    projects.push({
      id: planId,
      revision: typeof plan.revision === 'number' ? plan.revision : 1,
      goal: typeof plan.goal === 'string' ? plan.goal : '',
      mode,
      createdAt: typeof plan.createdAt === 'number' ? plan.createdAt : 0,
      segments,
      assets,
      ...(finalBytes !== undefined ? { final, finalBytes } : {}),
    })
  }
  projects.sort((a, b) => b.createdAt - a.createdAt)
  return { outputDir, projects, errors }
}
