/**
 * The video workbench, host half: a projection of the h3-video output directory over Connection
 * Fetch routes. `GET /api/video-workbench/projects` lists plan artifacts with their on-disk
 * rendering state; `GET /api/video-workbench/file?path=<relative>` serves one whitelisted file
 * (plan JSON, keyframe image, segment, or final assembly) confined to that directory; the two
 * `POST …/delete` routes remove a project or one recorded asset, moving the files into a trash
 * directory beside the projection rather than unlinking them. The directory is the only source of
 * truth — the pipeline writes, the workbench reads and trashes.
 * @module @deepseek-ai/dsh-video-workbench
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshCachePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
// Type-only: pulls the Connection host service merge (ctx.connection).
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveWorkbenchFile, workbenchFileResponse } from './file-serve.ts'
import { scanProjects } from './projects.ts'
import { deleteAsset, deleteProject } from './trash.ts'
import { StudioStore } from './studio-store.ts'
import type { StudioRenderOptions } from './studio-render.ts'
import { registerStudioRoutes } from './studio-routes.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared authoring owner consumed by future model-facing studio tools. */
    videoWorkbenchStudio: StudioStore
  }
}

export type { StudioDirectorScene, StudioId, ScriptKind, ScriptBlock, StudioContent, StudioDocument, StudioSummary, StudioCatalog } from './studio-types.ts'

export type {
  WorkbenchAssetRow,
  WorkbenchProject,
  WorkbenchSegmentRow,
  WorkbenchShot,
  WorkbenchSummary,
} from './projects.ts'
export type { ByteRange, FileRefusal, ResolvedFile } from './file-serve.ts'
export type { TrashResult } from './trash.ts'
export { parseRange, resolveWorkbenchFile, workbenchFileResponse } from './file-serve.ts'
export { scanProjects } from './projects.ts'
export { deleteAsset, deleteProject } from './trash.ts'

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
  /** Maximum encoded authoring document or request size in bytes. */
  maxStudioBytes?: number
  /** Local FFmpeg export executable paths, limits and output dimensions. */
  studioRender?: Partial<StudioRenderOptions>
}

export const Config: z<Config> = z.object({
  outputDir: z.string(),
  maxStudioBytes: z.number().min(1024).max(16777216).default(2097152),
  studioRender: z.object({
    ffmpegPath: z.string(), ffprobePath: z.string(), timeoutMs: z.number().min(1000).max(3600000),
    maxDurationSeconds: z.number().min(1).max(7200), maxClips: z.number().min(1).max(256),
    width: z.number().min(16).max(3840), height: z.number().min(16).max(2160), fps: z.number().min(1).max(60),
  }),
})

/** The projects listing route. */
const PROJECTS_PATH = '/api/video-workbench/projects'

/** The single-file route. */
const FILE_PATH = '/api/video-workbench/file'

/** Project deletion route. */
const PROJECT_DELETE_PATH = '/api/video-workbench/project/delete'

/** Asset deletion route. */
const ASSET_DELETE_PATH = '/api/video-workbench/asset/delete'

/**
 * Register the listing, media, and deletion routes on Connection's exact Fetch registry. Both carriers reach
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
  const maxStudioBytes = config.maxStudioBytes ?? 2097152
  const render: StudioRenderOptions = {
    ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', timeoutMs: 300000, maxDurationSeconds: 600,
    maxClips: 64, width: 1280, height: 720, fps: 30, ...config.studioRender,
  }
  if (![render.width, render.height].every(value => Number.isInteger(value) && value % 2 === 0)) {
    throw new Error('Studio export width and height must be even integers')
  }
  const studio = new StudioStore(outputDir, maxStudioBytes, render)
  ctx.provide('videoWorkbenchStudio', studio)
  registerStudioRoutes(ctx, studio, maxStudioBytes)

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
      return workbenchFileResponse(resolved, request.method, request.headers.get('range'))
    },
  }), 'video-workbench: file route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: PROJECT_DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body: unknown = await request.json()
        if (!isRecord(body) || typeof body.id !== 'string') return jsonResponse({ error: 'id is required' }, 400)
        return jsonResponse(await deleteProject(outputDir, body.id))
      } catch (error: unknown) {
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    },
  }), 'video-workbench: project deletion route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: ASSET_DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body: unknown = await request.json()
        if (!isRecord(body) || typeof body.planId !== 'string' || typeof body.assetId !== 'string') {
          return jsonResponse({ error: 'planId and assetId are required' }, 400)
        }
        return jsonResponse(await deleteAsset(outputDir, body.planId, body.assetId))
      } catch (error: unknown) {
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    },
  }), 'video-workbench: asset deletion route')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One JSON response with an explicit status.
 * @param value - payload to serialize.
 * @param status - HTTP status, 200 by default.
 * @returns the response a Fetch carrier hands back.
 */
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
