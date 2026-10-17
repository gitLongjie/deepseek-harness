/**
 * The video workbench, host half: a read-only projection of the h3-video output directory over
 * two Connection Fetch routes. `GET /api/video-workbench/projects` lists plan artifacts with
 * their on-disk rendering state; `GET /api/video-workbench/file?path=<relative>` serves one
 * whitelisted file (plan JSON, keyframe image, segment, or final assembly) confined to that
 * directory. The directory is the only source of truth — the pipeline writes, the workbench
 * reads.
 * @module @deepseek-ai/dsh-video-workbench
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshCachePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
// Type-only: pulls the Connection host service merge (ctx.connection).
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveWorkbenchFile, workbenchFileResponse } from './file-serve.ts'
import { scanProjects } from './projects.ts'

export type {
  WorkbenchProject,
  WorkbenchSegmentRow,
  WorkbenchSummary,
} from './projects.ts'
export type { FileRefusal, ResolvedFile } from './file-serve.ts'
export { resolveWorkbenchFile, workbenchFileResponse } from './file-serve.ts'
export { scanProjects } from './projects.ts'

/** Stable Cordis plugin name. */
export const name = 'video-workbench'

/** Required services (cordis fiber inject): the exact Fetch route registry every browser carrier dispatches through. */
export const inject = ['connection'] as const

/** Loader configuration: where the projected tree lives. */
export interface Config {
  /**
   * Directory the workbench projects; `~` expands to the OS home. Omission defaults to the same
   * DSH cache `video` directory the h3-video service uses (`$DSH_HOME/cache/video`), so a stock
   * deployment needs no configuration to see its renders.
   */
  outputDir?: string
}

export const Config: z<Config> = z.object({
  outputDir: z.string(),
})

/** The projects listing route. */
const PROJECTS_PATH = '/api/video-workbench/projects'

/** The single-file route. */
const FILE_PATH = '/api/video-workbench/file'

/**
 * Register the two read-only routes on Connection's exact Fetch registry. Both carriers reach
 * that registry — the browser's `/api` HTTP route and the desktop shell's in-process transport —
 * whereas a web-server route is visible only to the first. Registration goes through `ctx.effect`
 * so the disposers the registry returns own the rows for exactly this plugin's lifetime.
 * @param ctx - host plugin context.
 * @param config - loader-validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const outputDir = config.outputDir === undefined || config.outputDir.length === 0
    ? dshCachePath('video')
    : expandHomePath(config.outputDir)

  ctx.effect(() => ctx.connection.fetch.register({
    path: PROJECTS_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = `${JSON.stringify(await scanProjects(outputDir))}\n`
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    },
  }), 'video-workbench: projects route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: FILE_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const query = new URL(request.url).searchParams
      const resolved = await resolveWorkbenchFile(outputDir, query.get('path') ?? '')
      return workbenchFileResponse(resolved, request.method)
    },
  }), 'video-workbench: file route')
}
