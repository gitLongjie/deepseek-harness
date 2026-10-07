/**
 * The video workbench, host half: a read-only projection of the h3-video output directory over
 * two web-server routes. `GET /api/video-workbench/projects` lists plan artifacts with their
 * on-disk rendering state; `GET /api/video-workbench/file?path=<relative>` serves one whitelisted
 * file (plan JSON, keyframe image, segment, or final assembly) confined to that directory. The
 * directory is the only source of truth — the pipeline writes, the workbench reads.
 * @module @deepseek-ai/dsh-video-workbench
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshCachePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveWorkbenchFile, writeWorkbenchFile } from './file-serve.ts'
import { scanProjects } from './projects.ts'

export type {
  WorkbenchProject,
  WorkbenchSegmentRow,
  WorkbenchSummary,
} from './projects.ts'
export type { FileRefusal, ResolvedFile } from './file-serve.ts'
export { resolveWorkbenchFile, writeWorkbenchFile } from './file-serve.ts'
export { scanProjects } from './projects.ts'

/** Stable Cordis plugin name. */
export const name = 'video-workbench'

/** Required services (cordis fiber inject): the browser HTTP carrier. */
export const inject = ['webServer'] as const

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
 * Register the two read-only routes. Registration goes through `ctx.effect` so the disposers the
 * web-server returns own the rows for exactly this plugin's lifetime.
 * @param ctx - host plugin context.
 * @param config - loader-validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const outputDir = config.outputDir === undefined || config.outputDir.length === 0
    ? dshCachePath('video')
    : expandHomePath(config.outputDir)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PROJECTS_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const summary = await scanProjects(outputDir)
      const body = `${JSON.stringify(summary)}\n`
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'video-workbench: projects route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FILE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const query = new URL(req.url ?? '', 'http://video-workbench.invalid').searchParams
      const requested = query.get('path') ?? ''
      const resolved = await resolveWorkbenchFile(outputDir, requested)
      writeWorkbenchFile(resolved, req.method === 'HEAD', res)
    },
  }), 'video-workbench: file route')
}

/** Plugin default export: the loader row carrying the routes' configuration. */
export default { name, inject, Config, apply }
