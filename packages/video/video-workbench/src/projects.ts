/**
 * Project discovery for the video workbench: reads the plan artifacts the tool-video pipeline
 * writes and reports, per project, what has actually landed on disk. The directory is the only
 * source of truth — nothing here writes, and a corrupt plan becomes one error row instead of
 * failing the whole listing.
 * @module @deepseek-ai/dsh-video-workbench/projects
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Extensions the hosted image model can return; keyframe artifacts carry any of them. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.webp'] as const

/** One rendered-shot row of a project summary. */
export interface WorkbenchSegmentRow {
  /** Plan segment id (the synthetic `all` id for a multi-shot render). */
  readonly id: string
  /** Whether the canonical segment mp4 exists. */
  readonly rendered: boolean
  /** Absolute keyframe path when one exists for this segment. */
  readonly keyframe?: string
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
  /** Absolute final-assembly mp4 path when one exists. */
  readonly final?: string
  /** Bytes of the final assembly, when present. */
  readonly finalBytes?: number
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
}

interface PlanSegment {
  id?: unknown
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size
  } catch {
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
 * Scan one output directory into a workbench listing. A `plans` entry that is not valid JSON or
 * misses its identity fields becomes one `errors` row; the rest of the listing still renders.
 * @param outputDir - the h3-video output directory holding `plans/`, `segments/`, `keyframes/`,
 *   and `final/`.
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
  } catch {
    return { outputDir, projects: [], errors }
  }
  const projects: WorkbenchProject[] = []
  for (const name of planFiles) {
    const file = join(plansDir, name)
    let parsed: PlanFile
    try {
      parsed = JSON.parse(await readFile(file, 'utf8')) as PlanFile
    } catch (error: unknown) {
      errors.push(`plan ${name}: unreadable (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (parsed.id !== name.slice(0, -'.json'.length) || !Array.isArray(parsed.segments)) {
      errors.push(`plan ${name}: corrupt (id mismatch or segments missing)`)
      continue
    }
    const planId = parsed.id
    const segments: WorkbenchSegmentRow[] = []
    for (const entry of parsed.segments as PlanSegment[]) {
      const segmentId = typeof entry.id === 'string' ? entry.id : ''
      if (segmentId === '') continue
      const rendered = await exists(join(segmentsDir, `${planId}-${segmentId}.mp4`))
      const keyframe = await findKeyframe(keyframesDir, planId, segmentId)
      segments.push({ id: segmentId, ...keyframe !== undefined ? { keyframe } : {}, rendered })
    }
    if (parsed.mode === 'multi_shot') {
      // The whole storyboard renders as one task under the synthetic `all` id; the keyframe
      // artifact, when one exists, was generated for the first shot.
      const rendered = await exists(join(segmentsDir, `${planId}-all.mp4`))
      const keyframe = segments[0]?.keyframe
      segments.length = 0
      segments.push({ id: 'all', rendered, ...keyframe !== undefined ? { keyframe } : {} })
    }
    const final = join(finalsDir, `${planId}.mp4`)
    const finalBytes = await fileSize(final)
    projects.push({
      id: planId,
      revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
      goal: typeof parsed.goal === 'string' ? parsed.goal : '',
      mode: parsed.mode === 'per_segment' ? 'per_segment' : 'multi_shot',
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      segments,
      ...(finalBytes !== undefined ? { final, finalBytes } : {}),
    })
  }
  projects.sort((a, b) => b.createdAt - a.createdAt)
  return { outputDir, projects, errors }
}
