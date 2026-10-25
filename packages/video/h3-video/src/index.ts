/**
 * The H3 video provider seam: backend-neutral segment generation over a local ComfyUI deployment
 * or the hosted MiniMax V2 API, with explicit routing and ffmpeg assembly. This package's default
 * export is the {@link H3Video} Service class; loading it as a Cordis plugin registers the service
 * on `ctx.h3Video` from validated configuration. Misconfiguration fails loud at load.
 * @module @deepseek-ai/dsh-h3-video
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { dshCachePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { diskFreeBytes } from './disk.ts'
import { createComfyUIProvider } from './comfyui.ts'
import type { ComfyUIOptions } from './comfyui.ts'
import { createMiniMaxApiProvider } from './minimax-api.ts'
import type { MiniMaxApiOptions } from './minimax-api.ts'
import { createMiniMaxImageProvider } from './minimax-image.ts'
import type { KeyframeRequest, MiniMaxImageOptions } from './minimax-image.ts'
import { createComfyUIImageProvider } from './comfy-image.ts'
import { logRequest } from './log.ts'
import { resolve as routeRequest } from './routing.ts'
import type { BackendChoice, RoutedProvider } from './routing.ts'
import { assembleVideo } from './assembly.ts'
import type { AssemblyOptions, AssemblySegment } from './assembly.ts'
import type { H3TaskRef, ProviderCapabilities, SegmentRequest, TaskStatus } from './types.ts'
import type { H3VideoSettingsSection } from './settings.ts'
import { createAutoDLClient, createAutoDLVendor } from './autodl.ts'
import { GpuInstancePool } from './gpu.ts'
import type { GpuIdleAction, GpuStatus } from './gpu.ts'

export type {
  H3VideoProvider,
  ProviderCapabilities,
  SegmentInput,
  SegmentRequest,
  TaskStatus,
} from './types.ts'
export type { BackendChoice, ResolvedTarget, RoutedProvider } from './routing.ts'
export { RoutingError, resolve } from './routing.ts'
export { SegmentRequestError, validateSegmentRequest } from './validation.ts'
export { assembleVideo } from './assembly.ts'
export type { AssemblyOptions, AssemblySegment } from './assembly.ts'
export { diskFreeBytes } from './disk.ts'
export { snapH3Frames } from './comfyui.ts'
export { H3TaskRef } from './types.ts'
export { createComfyUIProvider } from './comfyui.ts'
export type { ComfyUIOptions } from './comfyui.ts'
export { createMiniMaxApiProvider } from './minimax-api.ts'
export type { MiniMaxApiOptions, ApiKeySource } from './minimax-api.ts'
export { createMiniMaxImageProvider } from './minimax-image.ts'
export type { KeyframeRequest, MiniMaxImageOptions } from './minimax-image.ts'
export { createComfyUIImageProvider } from './comfy-image.ts'
export type { ComfyImageOptions, ImageFetchLike } from './comfy-image.ts'
export { AutoDLClient, AutoDLError, createAutoDLClient, createAutoDLVendor, normalizeGpuRunState, serviceDomainUrl } from './autodl.ts'
export type { AutoDLClientOptions, AutoDLCreateSpec, AutoDLInstance, AutoDLSnapshot, AutoDLVendorOptions } from './autodl.ts'
export { GpuInstancePool } from './gpu.ts'
export type {
  GpuDisposeOptions,
  GpuIdleAction,
  GpuInstanceState,
  GpuPoolOptions,
  GpuRunState,
  GpuStatus,
  GpuVendor,
  GpuVendorInstance,
} from './gpu.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    h3Video: H3Video
  }
}

const RESOLUTIONS = ['480P', '768P', '2K'] as const

/**
 * Cloud GPU instance that serves the local ComfyUI backend, created on demand and stopped or
 * released when generation stops. The implemented vendor is AutoDL's container-instance Pro API;
 * `gpuSpecUuid` is the row's anchor — a row without it leaves the GPU unmanaged and keeps the
 * static `comfy.url`.
 */
export interface GpuConfig {
  /**
   * Compute specification id. AutoDL ids follow the account's GPU table (`v-32g-p`, `pro6000-p`,
   * `4090D`, …).
   */
  gpuSpecUuid?: string
  /** Boot image uuid carrying the ComfyUI installation and H3 weights. */
  imageUuid?: string
  /**
   * Account API token. Prefer `apiTokenRef` so the secret lives in the managed credential store; a
   * literal here lands in the composition file.
   */
  apiToken?: string
  /**
   * Credential reference resolved through `ctx.credentials` on every request (e.g.
   * `AUTODL_TOKEN`, stored via the credentials store or that environment variable).
   */
  apiTokenRef?: string
  /** Vendor API origin. */
  baseUrl?: string
  /** Minimum CUDA code the scheduled host must satisfy (118 = 11.8). */
  cudaVersion?: number
  /** GPU count, 1–4. */
  gpuAmount?: number
  /** System-disk expansion in GB, 0–500. */
  systemDiskGb?: number
  /** Preferred data centers, in order; the vendor schedules when omitted. */
  dataCenterList?: string[]
  /** Instance name; an existing instance with this name is powered on instead of creating another. */
  instanceName?: string
  /** Command the vendor runs after boot; it must start the ComfyUI server on `servicePort`. */
  startCommand?: string
  /** Service port the vendor maps to the ComfyUI HTTP API. */
  servicePort?: number
  /** Milliseconds between instance status and readiness polls. */
  pollIntervalMs?: number
  /** Wall-clock bound on boot plus ComfyUI readiness, in milliseconds. */
  bootTimeoutMs?: number
  /** Readiness probe bound per attempt, in milliseconds. */
  probeTimeoutMs?: number
  /** Per-call vendor API bound, in milliseconds. */
  requestTimeoutMs?: number
  /** Idle milliseconds before `idleAction` runs; `0` leaves the instance up until an explicit call. */
  idleTimeoutMs?: number
  /** What idle handling does: power the instance off (keeps its disk), or release it. */
  idleAction?: GpuIdleAction
  /** Release the instance when the video service is disposed, instead of leaving it to the idle policy. */
  releaseOnDispose?: boolean
}

/** Local ComfyUI backend row. */
export interface ComfyConfig {
  /** ComfyUI server origin; required unless `gpu` provisions one. */
  url?: string
  /** JSON workflow template path with `"{{field}}"` placeholders. */
  workflowPath?: string
  /** Placeholder names filled from each request field. */
  promptField?: string
  /** Resolution placeholder name. */
  resolutionField?: string
  /** Duration placeholder name. */
  durationField?: string
  /** Ratio placeholder name. */
  ratioField?: string
  /** Seed placeholder name. */
  seedField?: string
  /** Frame-count placeholder name; filled from the duration snapped to the H3 17k+5 grid. */
  lengthField?: string
  /**
   * ComfyUI `input` directory (e.g. `D:/ComfyUI/ComfyUI/input`); required for image-to-video, where
   * keyframe images are copied here and wired to the H3 node's first/last frame input.
   */
  inputDir?: string
  /** Milliseconds between history polls. */
  pollIntervalMs?: number
  /** Wall-clock bound on one generation. */
  taskTimeoutMs?: number
  /** Concurrent generations served locally. */
  maxConcurrency?: number
  /** Resolution tiers this deployment serves. */
  resolutions?: string[]
  /** Minimum accepted seconds per segment. */
  minDurationSeconds?: number
  /** Maximum accepted seconds per segment. */
  maxDurationSeconds?: number
  /** Cloud GPU row; present and anchored, it supplies `url` from the provisioned instance. */
  gpu?: GpuConfig
  /**
   * Local text-to-image row: the ComfyUI workflow that generates keyframes and asset stills on the
   * same machine as the video. Present and anchored, it replaces the hosted image API, so stills
   * cost GPU time instead of per-image billing.
   */
  image?: ComfyImageConfig
}

/** Local text-to-image row over a ComfyUI workflow template. */
export interface ComfyImageConfig {
  /** JSON workflow template with `"{{prompt}}"`, `"{{seed}}"`, `"{{width}}"`, `"{{height}}"`. */
  workflowPath?: string
  /**
   * Workflow used when the request carries a confirmed portrait: it gets the same placeholders plus
   * `"{{reference}}"`, the uploaded image name, so the still is redrawn from that face.
   */
  referenceWorkflowPath?: string
  /** Prompt placeholder name. */
  promptField?: string
  /** Reference-image placeholder name (reference workflow only). */
  referenceField?: string
  /** Seed placeholder name. */
  seedField?: string
  /** Width placeholder name. */
  widthField?: string
  /** Height placeholder name. */
  heightField?: string
  /** Milliseconds between history polls. */
  pollIntervalMs?: number
  /** Wall-clock bound on one still. */
  taskTimeoutMs?: number
}

/** Text-to-image backend behind keyframes and asset stills. */
export interface ImageProvider {
  /**
   * Generate one still.
   * @param request - prompt, ratio, and optional seed.
   * @param signal - cancellation.
   * @returns the absolute path of the written image.
   */
  generate(request: KeyframeRequest, signal: AbortSignal): Promise<string>
}

/** Hosted MiniMax backend row. */
export interface MinimaxConfig {
  /**
   * Literal account API key sent as bearer token. Prefer `apiKeyRef` so the secret lives in the
   * managed credentials store; a literal here lands in the composition file.
   */
  apiKey?: string
  /**
   * Credential reference name resolved through `ctx.credentials` per request (e.g.
   * `MINIMAX_API_KEY`, stored via the credentials store or that environment variable). Exactly one
   * of `apiKey` and `apiKeyRef` enables the remote backend.
   */
  apiKeyRef?: string
  /** API origin. */
  baseUrl?: string
  /**
   * Model release id the account has enabled. Known ids (`MiniMax-H3`, `MiniMax-H3-Max`) carry
   * their published envelope; any other id requires `resolutions` and the duration range below.
   */
  model?: string
  /** Resolution tiers the release accepts; overrides the published envelope for `model`. */
  resolutions?: string[]
  /** Inclusive shortest segment the release accepts, in seconds. */
  minDurationSeconds?: number
  /** Inclusive longest segment the release accepts, in seconds. */
  maxDurationSeconds?: number
  /** Image model used for keyframe generation (`image-01` or `image-01-live`). */
  imageModel?: string
  /** Milliseconds between task queries. */
  pollIntervalMs?: number
  /** Wall-clock bound on one remote task. */
  taskTimeoutMs?: number
  /** Concurrent remote generations. */
  maxConcurrency?: number
}

/** Validated configuration shape. */
export interface Config {
  /**
   * Directory receiving downloaded segments, plans, and final assemblies; `~` expands to the OS
   * home. Omission defaults to the DSH cache `video` directory (`$DSH_HOME/cache/video`).
   */
  outputDir?: string
  /**
   * Hard floor of free megabytes the output volume must keep beyond the size estimate, in
   * addition to `estimatedBytesPerSecond` × duration. A generation is refused before submission
   * when the volume cannot hold both.
   */
  minFreeSpaceMb?: number
  /**
   * Size estimate per second of generated output, used with `minFreeSpaceMb` to refuse a download
   * that would fill the disk. Tune to your model's bitrate (H3 768P ≈ 0.5 MB/s; 2K is higher).
   */
  estimatedBytesPerSecond?: number
  /** Local ComfyUI deployment; absent disables the `local` choice. */
  comfy?: ComfyConfig
  /** Hosted MiniMax API; absent disables the `remote` choice. */
  minimax?: MinimaxConfig
}

/** Loader schema for the H3 video service. `comfy` and `minimax` rows are optional (absent input
 * validates to `undefined`); the constructor fails loud when neither backend is configured. */
export const Config = z.object({
  outputDir: z.string(),
  minFreeSpaceMb: z.number().step(1).min(0).default(1024),
  estimatedBytesPerSecond: z.number().min(1).default(2_000_000),
  comfy: z.object({
    url: z.string(),
    workflowPath: z.string(),
    promptField: z.string().default('prompt'),
    resolutionField: z.string().default('resolution'),
    durationField: z.string().default('duration'),
    ratioField: z.string().default('ratio'),
    seedField: z.string().default('seed'),
    lengthField: z.string().default('length'),
    inputDir: z.string(),
    pollIntervalMs: z.number().min(500).default(5_000),
    taskTimeoutMs: z.number().min(60_000).default(3_600_000),
    maxConcurrency: z.number().step(1).min(1).default(1),
    resolutions: z.array(z.union(RESOLUTIONS)).default(['768P']),
    minDurationSeconds: z.number().step(1).min(1).default(4),
    maxDurationSeconds: z.number().step(1).min(1).default(10),
    gpu: z.object({
      gpuSpecUuid: z.string(),
      imageUuid: z.string(),
      apiToken: z.string(),
      apiTokenRef: z.string(),
      baseUrl: z.string().default('https://api.autodl.com'),
      cudaVersion: z.number().step(1).min(0).default(118),
      gpuAmount: z.number().step(1).min(1).max(4).default(1),
      systemDiskGb: z.number().step(1).min(0).max(500).default(0),
      dataCenterList: z.array(z.string()),
      instanceName: z.string().default('dsh-h3-video'),
      startCommand: z.string(),
      servicePort: z.number().step(1).min(1).max(65_535).default(6006),
      pollIntervalMs: z.number().min(1_000).default(10_000),
      bootTimeoutMs: z.number().min(60_000).default(1_800_000),
      probeTimeoutMs: z.number().min(1_000).default(15_000),
      requestTimeoutMs: z.number().min(1_000).default(60_000),
      idleTimeoutMs: z.number().step(1).min(0).default(1_800_000),
      idleAction: z.union(['power_off', 'release'] as const).default('power_off'),
      releaseOnDispose: z.boolean().default(false),
    }),
    image: z.object({
      workflowPath: z.string(),
      referenceWorkflowPath: z.string(),
      promptField: z.string().default('prompt'),
      referenceField: z.string().default('reference'),
      seedField: z.string().default('seed'),
      widthField: z.string().default('width'),
      heightField: z.string().default('height'),
      pollIntervalMs: z.number().min(500).default(3_000),
      taskTimeoutMs: z.number().min(60_000).default(600_000),
    }),
  }),
  minimax: z.object({
    apiKey: z.string(),
    apiKeyRef: z.string(),
    baseUrl: z.string().default('https://api.minimax.cn'),
    model: z.string().default('MiniMax-H3'),
    resolutions: z.array(z.union(RESOLUTIONS)),
    minDurationSeconds: z.number().step(1).min(1),
    maxDurationSeconds: z.number().step(1).min(1),
    imageModel: z.union(['image-01', 'image-01-live'] as const).default('image-01'),
    pollIntervalMs: z.number().min(1_000).default(10_000),
    taskTimeoutMs: z.number().min(60_000).default(1_800_000),
    maxConcurrency: z.number().step(1).min(1).default(3),
  }),
})

/**
 * Resolve the configured output directory. Omission uses the DSH cache `video` directory
 * (`$DSH_HOME/cache/video`, default `~/.dsh/cache/video`) so downloads live with the harness's
 * other user data and respect `$DSH_HOME`; an explicit value supports `~` expansion.
 * @param configured - the validated config value, or `undefined` when omitted.
 * @returns the absolute output directory.
 */
function resolveOutputDir(configured: string | undefined): string {
  return configured === undefined ? dshCachePath('video') : expandHomePath(configured)
}

/**
 * Video-generation service surface consumed by tool plugins. Every operation takes the caller's
 * explicit backend choice; no call path receives an implicit default.
 */
export abstract class H3Video extends Service {
  constructor(ctx: Context) {
    super(ctx, 'h3Video')
  }

  /** Configured backends keyed by routing label. */
  abstract get providers(): readonly RoutedProvider[]

  /** Absolute directory where generated segments land. */
  abstract get outputDir(): string

  /**
   * Query the free space on the volume holding the output directory.
   * @returns free megabytes, or `undefined` when the volume cannot be queried.
   */
  abstract diskFreeMegabytes(): Promise<number | undefined>

  /**
   * Static limits of one configured backend.
   * @param choice - routing label.
   * @returns the backend's declared capabilities, or `undefined` when that backend is not configured.
   */
  abstract capabilities(choice: Exclude<BackendChoice, 'auto'>): ProviderCapabilities | undefined

  /**
   * Validate one request against one backend without submitting it.
   * @param choice - routing policy to check.
   * @param request - candidate segment request.
   * @returns whether that backend can serve the request as written.
   */
  abstract canServe(choice: BackendChoice, request: SegmentRequest): boolean

  /**
   * Route by the caller's policy, validate, and submit one segment.
   * @param choice - explicit backend policy.
   * @param request - the segment to generate.
   * @param signal - submission cancellation.
   * @returns the chosen backend and its task reference.
   */
  abstract submit(
    choice: BackendChoice,
    request: SegmentRequest,
    signal: AbortSignal,
  ): Promise<{ readonly target: RoutedProvider; readonly ref: H3TaskRef }>

  /**
   * Observe a submitted task once through its owning backend.
   * @param target - the routed provider returned by {@link submit}.
   * @param ref - the task reference.
   * @param signal - observation cancellation.
   * @returns the task's current state, including the local file once it succeeds.
   */
  abstract poll(target: RoutedProvider, ref: H3TaskRef, signal: AbortSignal): Promise<TaskStatus>

  /**
   * Best-effort cancel on the owning backend.
   * @param target - routed provider.
   * @param ref - task reference.
   */
  abstract cancel(target: RoutedProvider, ref: H3TaskRef): Promise<void>

  /**
   * Generate one still keyframe for a shot, establishing the scene before video generation. Uses
   * the hosted image model; local ComfyUI has no H3 text-to-image node.
   * @param request - shot description, aspect ratio, optional seed, and an optional character
   * reference that keeps the still on the confirmed character.
   * @param signal - cancellation of the keyframe generation.
   * @returns the absolute path of the downloaded keyframe file.
   */
  abstract keyframe(request: KeyframeRequest, signal: AbortSignal): Promise<string>

  /**
   * Concatenate ordered segment files into one mp4.
   * @param segments - ordered files.
   * @param options - output location and optional ffmpeg override.
   * @returns the absolute path of the assembled mp4.
   */
  abstract assemble(segments: readonly AssemblySegment[], options: AssemblyOptions): Promise<string>

  /**
   * Read the cloud GPU backing the local backend. With a tracked instance the vendor state is
   * re-read; otherwise the cached lifecycle view answers immediately.
   * @returns the lifecycle view; `configured: false` when the composition carries no GPU row.
   */
  abstract gpuStatus(): Promise<GpuStatus>

  /**
   * Boot or reuse the cloud GPU and wait until ComfyUI answers. A routable local submission does
   * this implicitly; calling it first surfaces boot failures before a render is submitted.
   * @returns the lifecycle view once the instance is running.
   */
  abstract gpuUp(): Promise<GpuStatus>

  /**
   * Power the cloud GPU off, or release it and its disk. Cloud GPU time is billed while it runs.
   * @param mode - `stop` keeps the instance for a later boot; `release` deletes it.
   * @returns the lifecycle view after the operation.
   */
  abstract gpuDown(mode: 'stop' | 'release'): Promise<GpuStatus>
}

/**
 * Layer the user settings section over the composition configuration. Every
 * overlay field is optional; a present, non-empty value replaces the
 * composition's, an absent one inherits it. The flat settings names map onto
 * the composition's `comfy`/`minimax` rows here — the one explicit place the
 * two vocabularies meet.
 * @param base - the loader-validated composition configuration.
 * @param overlay - the committed `h3-video` settings section.
 * @returns the effective configuration the service builds its providers from.
 */
export function resolveOverlayConfig(base: Config, overlay: H3VideoSettingsSection): Config {
  const text = (value: string | undefined): string | undefined =>
    value !== undefined && value.length > 0 ? value : undefined
  const comfyOverlay: Partial<NonNullable<Config['comfy']>> = {}
  const comfyUrl = text(overlay.comfyUrl)
  const comfyWorkflowPath = text(overlay.comfyWorkflowPath)
  const comfyInputDir = text(overlay.comfyInputDir)
  if (comfyUrl !== undefined) comfyOverlay.url = comfyUrl
  if (comfyWorkflowPath !== undefined) comfyOverlay.workflowPath = comfyWorkflowPath
  if (comfyInputDir !== undefined) comfyOverlay.inputDir = comfyInputDir
  if (overlay.comfyPollIntervalMs !== undefined) comfyOverlay.pollIntervalMs = overlay.comfyPollIntervalMs
  if (overlay.comfyTaskTimeoutMs !== undefined) comfyOverlay.taskTimeoutMs = overlay.comfyTaskTimeoutMs
  if (overlay.comfyMaxConcurrency !== undefined) comfyOverlay.maxConcurrency = overlay.comfyMaxConcurrency
  const comfyResolutions = overlay.comfyResolutions
  if (comfyResolutions !== undefined && comfyResolutions.length > 0) {
    comfyOverlay.resolutions = comfyResolutions
  }
  if (overlay.comfyMinDurationSeconds !== undefined) comfyOverlay.minDurationSeconds = overlay.comfyMinDurationSeconds
  if (overlay.comfyMaxDurationSeconds !== undefined) comfyOverlay.maxDurationSeconds = overlay.comfyMaxDurationSeconds
  const minimaxOverlay: Partial<NonNullable<Config['minimax']>> = {}
  const minimaxBaseUrl = text(overlay.minimaxBaseUrl)
  const minimaxApiKeyRef = text(overlay.minimaxApiKeyRef)
  const gpuApiTokenRef = text(overlay.gpuApiTokenRef)
  const minimaxModel = text(overlay.minimaxModel)
  if (minimaxBaseUrl !== undefined) minimaxOverlay.baseUrl = minimaxBaseUrl
  if (minimaxModel !== undefined) minimaxOverlay.model = minimaxModel
  const minimaxResolutions = overlay.minimaxResolutions
  if (minimaxResolutions !== undefined && minimaxResolutions.length > 0) {
    minimaxOverlay.resolutions = minimaxResolutions
  }
  if (overlay.minimaxMinDurationSeconds !== undefined) minimaxOverlay.minDurationSeconds = overlay.minimaxMinDurationSeconds
  if (overlay.minimaxMaxDurationSeconds !== undefined) minimaxOverlay.maxDurationSeconds = overlay.minimaxMaxDurationSeconds
  if (minimaxApiKeyRef !== undefined) minimaxOverlay.apiKeyRef = minimaxApiKeyRef
  if (overlay.minimaxPollIntervalMs !== undefined) minimaxOverlay.pollIntervalMs = overlay.minimaxPollIntervalMs
  if (overlay.minimaxTaskTimeoutMs !== undefined) minimaxOverlay.taskTimeoutMs = overlay.minimaxTaskTimeoutMs
  if (overlay.minimaxMaxConcurrency !== undefined) minimaxOverlay.maxConcurrency = overlay.minimaxMaxConcurrency
  const outputDir = text(overlay.outputDir) ?? base.outputDir
  const minFreeSpaceMb = overlay.minFreeSpaceMb ?? base.minFreeSpaceMb
  const estimatedBytesPerSecond = overlay.estimatedBytesPerSecond ?? base.estimatedBytesPerSecond
  // The GPU row is nested under `comfy`, so the flat reference replaces just that field and keeps
  // the composition's compute specification, image, and boot command.
  const gpu = gpuApiTokenRef === undefined
    ? base.comfy?.gpu
    : { ...base.comfy?.gpu, apiTokenRef: gpuApiTokenRef }
  const comfy = base.comfy === undefined && Object.keys(comfyOverlay).length === 0
    ? undefined
    : { ...base.comfy, ...comfyOverlay, ...gpu !== undefined ? { gpu } : {} }
  const minimax = base.minimax === undefined && Object.keys(minimaxOverlay).length === 0
    ? undefined
    : { ...base.minimax, ...minimaxOverlay }
  return {
    ...(outputDir !== undefined ? { outputDir } : {}),
    ...(minFreeSpaceMb !== undefined ? { minFreeSpaceMb } : {}),
    ...(estimatedBytesPerSecond !== undefined ? { estimatedBytesPerSecond } : {}),
    ...(comfy !== undefined ? { comfy } : {}),
    ...(minimax !== undefined ? { minimax } : {}),
  }
}

/**
 * Resolve a credential reference into a per-request secret source.
 * @param ctx - plugin context carrying the optional credentials service.
 * @param ref - reference name, e.g. `AUTODL_TOKEN`.
 * @param requirement - configuration field that named the reference, for the failure message.
 * @returns a resolver reading the current secret on every call.
 */
function credentialSource(ctx: Context, ref: string, requirement: string): () => Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new Error(`h3-video: ${requirement} requires the credentials service (load @deepseek-ai/dsh-credentials-local)`)
  }
  const branded = credentialRef(ref)
  return async () => {
    const resolved = await credentials.resolve(branded)
    if (resolved === undefined) {
      throw new Error(`h3-video: credential ${ref} is not configured (store it via the credentials service or the ${ref} environment variable)`)
    }
    return resolved.value
  }
}

/**
 * Ask a ComfyUI origin whether it answers. The static local backend has no cloud GPU row to report
 * its lifecycle, so a status call is the only way a caller learns whether it is serving.
 * @param url - ComfyUI origin.
 * @returns whether `/system_stats` answered within the probe bound.
 */
async function probeComfy(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 1_500)
  timer.unref()
  try {
    const response = await fetch(`${url.replace(/\/+$/u, '')}/system_stats`, { signal: controller.signal })
    return response.ok
  } catch {
    // Unreachable, refused, or timed out all mean the same thing to a caller: not serving now.
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** The in-process {@link H3Video} over configured backends. */
class LocalH3Video extends H3Video {
  static inject = [] as const
  static Config = Config

  private providersList: readonly RoutedProvider[] = []
  private imageProvider: ImageProvider | undefined
  private outputDirectory: string = ''
  private gpuPool: GpuInstancePool | undefined
  /** Address the local backend was configured with, when no cloud GPU row supplies one. */
  private staticComfyUrl: string | undefined
  /** Which image backend keyframes use, for the request log. */
  private imageProviderName: 'comfy-img2img' | 'comfy-txt2img' | 'minimax' = 'minimax'
  /** Local task references still being polled; each one blocks idle GPU teardown. */
  private readonly liveLocalTasks = new Set<string>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // The host-plane settings view, absent when the deployment mounts no
    // `./settings` entry (unit tests, minimal hosts). The overlay resolves
    // BEFORE the first build, so a mounted preset serves the committed values
    // from its first request.
    const view = ctx.get('h3VideoSettings')
    this.build(view === undefined ? config : resolveOverlayConfig(config, view.get()))
    ctx.effect(() => async () => { await this.gpuPool?.dispose() }, 'h3-video: gpu instance pool')
    if (view === undefined) return
    ctx.effect(
      () => view.watch((next) => {
        try {
          this.build(resolveOverlayConfig(config, next))
        } catch (error) {
          // A committed section the composition cannot carry (an overlay
          // enabling a backend whose service dependency is missing) keeps the
          // last good providers; the composition's own load-time values are
          // the loud-failure surface, this is the live-edit one.
          ctx.logger.warn(error)
        }
      }),
      'h3-video: settings overlay',
    )
  }

  /** (Re)build every provider from one effective configuration. */
  private build(config: Config): void {
    const outputDir = resolveOutputDir(config.outputDir)
    this.outputDirectory = outputDir
    const minFreeSpaceBytes = (config.minFreeSpaceMb ?? 1024) * 1024 * 1024
    const estimatedBytesPerSecond = config.estimatedBytesPerSecond ?? 2_000_000
    const comfy = config.comfy
    const minimax = config.minimax
    // Schemastery object schemas fill an absent optional key with the row's defaulted output, so a
    // row is "enabled" only through its no-default anchor field: comfy.workflowPath for local,
    // minimax.apiKey or minimax.apiKeyRef for remote. The anchor is documented as the enable switch.
    const hasComfy = typeof comfy?.workflowPath === 'string' && comfy.workflowPath.length > 0
    const hasMinimax = (typeof minimax?.apiKey === 'string' && minimax.apiKey.length > 0)
      || (typeof minimax?.apiKeyRef === 'string' && minimax.apiKeyRef.length > 0)
    if (!hasComfy && !hasMinimax) {
      throw new Error('h3-video: configure at least one backend (set comfy.workflowPath and/or minimax.apiKey)')
    }
    const providers: RoutedProvider[] = []
    const gpuPool = this.buildGpuPool(config)
    if (comfy !== undefined) {
      const workflowPath = comfy.workflowPath
      if (typeof workflowPath === 'string' && workflowPath.length > 0) {
        if (gpuPool === undefined) {
          // A wrong address here is invisible until a render fails, and a fallback would send the
          // work to a machine the deployment never named — so an absent address fails at load,
          // where the fix is obvious.
          const configured = comfy.url
          if (typeof configured !== 'string' || configured.length === 0) {
            throw new Error(
              'h3-video: comfy.url is required when no cloud GPU row supplies the address '
              + '(set it to the ComfyUI origin, e.g. https://host:8443)',
            )
          }
        }
        const options: ComfyUIOptions = {
          ...(gpuPool === undefined
            ? { baseUrl: comfy.url as string }
            : { resolveBaseUrl: () => gpuPool.ensure() }),
          workflowPath: expandHomePath(workflowPath),
          promptField: comfy.promptField ?? 'prompt',
          resolutionField: comfy.resolutionField ?? 'resolution',
          durationField: comfy.durationField ?? 'duration',
          ratioField: comfy.ratioField ?? 'ratio',
          seedField: comfy.seedField ?? 'seed',
          lengthField: comfy.lengthField ?? 'length',
          ...comfy.inputDir !== undefined ? { inputDir: expandHomePath(comfy.inputDir) } : {},
          outputDir,
          pollIntervalMs: comfy.pollIntervalMs ?? 5_000,
          taskTimeoutMs: comfy.taskTimeoutMs ?? 3_600_000,
          maxConcurrency: comfy.maxConcurrency ?? 1,
          resolutions: (comfy.resolutions ?? ['768P']) as ComfyUIOptions['resolutions'],
          minDurationSeconds: comfy.minDurationSeconds ?? 4,
          maxDurationSeconds: comfy.maxDurationSeconds ?? 10,
          minFreeSpaceBytes,
          estimatedBytesPerSecond,
        }
        providers.push({ choice: 'local', provider: createComfyUIProvider(options) })
        if (gpuPool === undefined) this.staticComfyUrl = comfy.url as string
        const imageWorkflow = comfy.image?.workflowPath
        if (typeof imageWorkflow === 'string' && imageWorkflow.length > 0) {
          // Stills on the same GPU as the video: no per-image billing, and one machine to keep up.
          this.imageProvider = createComfyUIImageProvider({
            baseUrl: comfy.url as string,
            workflowPath: expandHomePath(imageWorkflow),
            ...(typeof comfy.image?.referenceWorkflowPath === 'string' && comfy.image.referenceWorkflowPath.length > 0
              ? { referenceWorkflowPath: expandHomePath(comfy.image.referenceWorkflowPath) }
              : {}),
            promptField: comfy.image?.promptField ?? 'prompt',
            referenceField: comfy.image?.referenceField ?? 'reference',
            seedField: comfy.image?.seedField ?? 'seed',
            widthField: comfy.image?.widthField ?? 'width',
            heightField: comfy.image?.heightField ?? 'height',
            outputDir: join(outputDir, 'keyframes'),
            pollIntervalMs: comfy.image?.pollIntervalMs ?? 3_000,
            taskTimeoutMs: comfy.image?.taskTimeoutMs ?? 600_000,
          })
          this.imageProviderName = typeof comfy.image?.referenceWorkflowPath === 'string'
            && comfy.image.referenceWorkflowPath.length > 0
            ? 'comfy-img2img'
            : 'comfy-txt2img'
        }
      }
    }
    if (hasMinimax) {
      const mm = minimax
      const apiKey = mm.apiKey
      const apiKeyRef = mm.apiKeyRef
      const baseUrl = mm.baseUrl ?? 'https://api.minimax.cn'
      let apiKeySource: MiniMaxApiOptions['apiKey']
      if (typeof apiKey === 'string' && apiKey.length > 0) {
        apiKeySource = apiKey
      } else if (typeof apiKeyRef === 'string' && apiKeyRef.length > 0) {
        apiKeySource = credentialSource(this.ctx, apiKeyRef, 'minimax.apiKeyRef')
      } else {
        throw new Error('h3-video: minimax.apiKey or minimax.apiKeyRef is required to enable the remote backend')
      }
      const videoOptions: MiniMaxApiOptions = {
        apiKey: apiKeySource,
        baseUrl,
        model: mm.model ?? 'MiniMax-H3',
        ...(mm.resolutions !== undefined && mm.resolutions.length > 0
          ? { resolutions: mm.resolutions as NonNullable<MiniMaxApiOptions['resolutions']> }
          : {}),
        ...(mm.minDurationSeconds !== undefined ? { minDurationSeconds: mm.minDurationSeconds } : {}),
        ...(mm.maxDurationSeconds !== undefined ? { maxDurationSeconds: mm.maxDurationSeconds } : {}),
        outputDir,
        pollIntervalMs: mm.pollIntervalMs ?? 10_000,
        taskTimeoutMs: mm.taskTimeoutMs ?? 1_800_000,
        maxConcurrency: mm.maxConcurrency ?? 3,
        minFreeSpaceBytes,
        estimatedBytesPerSecond,
      }
      providers.push({ choice: 'remote', provider: createMiniMaxApiProvider(videoOptions) })
      // The local image workflow, when configured, already owns stills: the hosted image API then
      // stays unused rather than shadowing it.
      if (this.imageProvider === undefined) {
        this.imageProvider = createMiniMaxImageProvider({
          apiKey: apiKeySource,
          baseUrl,
          model: (mm.imageModel ?? 'image-01') as MiniMaxImageOptions['model'],
          outputDir: join(outputDir, 'keyframes'),
          minFreeSpaceBytes,
        })
        this.imageProviderName = 'minimax'
      }
    }
    this.providersList = providers
    // Swap the pool only after every provider built, so a rejected rebuild keeps serving the last
    // good configuration. A superseded pool stops its timers but leaves the instance to the new
    // pool's reuse key instead of billing a stop and an immediate boot.
    const previousPool = this.gpuPool
    this.gpuPool = gpuPool
    if (previousPool !== undefined) void previousPool.dispose({ release: false })
  }

  /**
   * Build the cloud GPU pool from the composition's `comfy.gpu` row.
   * @param config - effective configuration.
   * @returns the pool, or `undefined` when the row carries no anchor.
   */
  private buildGpuPool(config: Config): GpuInstancePool | undefined {
    const comfy = config.comfy
    const gpu = comfy?.gpu
    if (comfy === undefined || gpu === undefined) return undefined
    const gpuSpecUuid = gpu.gpuSpecUuid
    if (typeof gpuSpecUuid !== 'string' || gpuSpecUuid.length === 0) return undefined
    if (typeof comfy.url === 'string' && comfy.url.length > 0) {
      throw new Error(
        'h3-video: comfy.url and comfy.gpu are mutually exclusive; the ComfyUI address comes from the provisioned instance',
      )
    }
    if (typeof comfy.inputDir === 'string' && comfy.inputDir.length > 0) {
      throw new Error(
        'h3-video: comfy.inputDir is a local path and cannot reach a provisioned GPU; drop it so keyframes upload through the ComfyUI API',
      )
    }
    const imageUuid = gpu.imageUuid
    if (typeof imageUuid !== 'string' || imageUuid.length === 0) {
      throw new Error('h3-video: comfy.gpu.imageUuid is required alongside comfy.gpu.gpuSpecUuid')
    }
    let token: string | (() => Promise<string>)
    if (typeof gpu.apiToken === 'string' && gpu.apiToken.length > 0) {
      token = gpu.apiToken
    } else if (typeof gpu.apiTokenRef === 'string' && gpu.apiTokenRef.length > 0) {
      token = credentialSource(this.ctx, gpu.apiTokenRef, 'comfy.gpu.apiTokenRef')
    } else {
      throw new Error('h3-video: comfy.gpu.apiToken or comfy.gpu.apiTokenRef is required to provision a GPU instance')
    }
    const instanceName = gpu.instanceName ?? 'dsh-h3-video'
    const servicePort = gpu.servicePort ?? 6006
    const probeTimeoutMs = gpu.probeTimeoutMs ?? 15_000
    const vendor = createAutoDLVendor({
      client: createAutoDLClient({
        token,
        baseUrl: gpu.baseUrl ?? 'https://api.autodl.com',
        timeoutMs: gpu.requestTimeoutMs ?? 60_000,
      }),
      spec: {
        gpuSpecUuid,
        imageUuid,
        cudaVersion: gpu.cudaVersion ?? 118,
        gpuAmount: gpu.gpuAmount ?? 1,
        systemDiskGb: gpu.systemDiskGb ?? 0,
        ...(gpu.dataCenterList !== undefined && gpu.dataCenterList.length > 0
          ? { dataCenterList: gpu.dataCenterList }
          : {}),
        ...(typeof gpu.startCommand === 'string' && gpu.startCommand.length > 0
          ? { startCommand: gpu.startCommand }
          : {}),
      },
      instanceName,
      servicePort,
    })
    return new GpuInstancePool({
      vendor,
      instanceName,
      servicePort,
      pollIntervalMs: gpu.pollIntervalMs ?? 10_000,
      bootTimeoutMs: gpu.bootTimeoutMs ?? 1_800_000,
      idleTimeoutMs: gpu.idleTimeoutMs ?? 1_800_000,
      idleAction: gpu.idleAction ?? 'power_off',
      releaseOnDispose: gpu.releaseOnDispose ?? false,
      probe: async (url: string) => {
        try {
          const response = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(probeTimeoutMs) })
          return response.ok
        } catch {
          // A booting instance refuses connections or times out; readiness is the retry loop.
          return false
        }
      },
    })
  }

  override get providers(): readonly RoutedProvider[] {
    return this.providersList
  }

  override get outputDir(): string {
    return this.outputDirectory
  }

  override async keyframe(request: KeyframeRequest, signal: AbortSignal): Promise<string> {
    if (this.imageProvider === undefined) {
      throw new Error('h3-video: keyframe generation needs an image backend (set comfy.image.workflowPath for the local GPU, or minimax.apiKey for the hosted API)')
    }
    const file = await this.imageProvider.generate(request, signal)
    // The log records what the still was actually conditioned on: a missing portrait is the usual
    // reason a character comes back invented, and this is where that shows up.
    await logRequest(this.outputDirectory, 'keyframe', {
      provider: this.imageProviderName,
      subjectReference: request.subjectReference ?? null,
      ratio: request.ratio,
      seed: request.seed ?? null,
      promptHead: request.prompt.slice(0, 160),
      file,
    })
    return file
  }

  override diskFreeMegabytes(): Promise<number | undefined> {
    return diskFreeBytes(this.outputDirectory).then(free =>
      free === undefined ? undefined : Math.floor(free / 1024 / 1024))
  }

  override capabilities(choice: Exclude<BackendChoice, 'auto'>): ProviderCapabilities | undefined {
    return this.providersList.find(entry => entry.choice === choice)?.provider.capabilities
  }

  override canServe(choice: BackendChoice, request: SegmentRequest): boolean {
    try {
      routeRequest(choice, this.providersList, request)
      return true
    } catch {
      return false
    }
  }

  override async submit(
    choice: BackendChoice,
    request: SegmentRequest,
    signal: AbortSignal,
  ): Promise<{ readonly target: RoutedProvider; readonly ref: H3TaskRef }> {
    const resolved = routeRequest(choice, this.providersList, request)
    await logRequest(this.outputDirectory, 'video', {
      requested: choice,
      resolved: resolved.choice,
      ratio: request.ratio,
      durationSeconds: request.durationSeconds,
      inputs: request.inputs.map(input => input.type === 'text'
        ? { type: 'text', head: input.text.slice(0, 120) }
        : { type: input.type, role: input.role, source: input.url }),
    })
    // A routable local submission owns the cloud GPU: boot (or reuse) it before the workflow is
    // enqueued, and hold the idle timer off until this task settles.
    const pool = resolved.choice === 'local' ? this.gpuPool : undefined
    if (pool !== undefined) {
      await pool.ensure()
      pool.taskStarted()
    }
    let ref: H3TaskRef
    try {
      ref = await resolved.provider.submit(request, signal)
    } catch (error: unknown) {
      if (pool !== undefined) pool.taskFinished()
      throw error
    }
    if (pool !== undefined) this.liveLocalTasks.add(String(ref))
    return { target: { choice: resolved.choice, provider: resolved.provider }, ref }
  }

  override async poll(target: RoutedProvider, ref: H3TaskRef, signal: AbortSignal): Promise<TaskStatus> {
    try {
      const status = await target.provider.poll(ref, signal)
      if (status.state === 'succeeded' || status.state === 'failed') this.settleLocalTask(target, ref)
      return status
    } catch (error: unknown) {
      // A poll that throws (cancellation, transport failure) also ends this task.
      this.settleLocalTask(target, ref)
      throw error
    }
  }

  override async cancel(target: RoutedProvider, ref: H3TaskRef): Promise<void> {
    try {
      await target.provider.cancel(ref)
    } finally {
      this.settleLocalTask(target, ref)
    }
  }

  override assemble(segments: readonly AssemblySegment[], options: AssemblyOptions): Promise<string> {
    return assembleVideo(segments, options)
  }

  override async gpuStatus(): Promise<GpuStatus> {
    if (this.gpuPool !== undefined) return await this.gpuPool.refresh()
    const url = this.staticComfyUrl
    if (url === undefined) return { configured: false, state: 'absent' }
    // A static address is a real local backend even though no cloud GPU row manages it; reporting
    // it as "not configured" reads as "no local backend", which sends callers to the paid API.
    const reachable = await probeComfy(url)
    return {
      configured: true,
      vendor: 'static',
      serviceUrl: url,
      state: reachable ? 'running' : 'stopped',
      ...reachable ? {} : { error: `ComfyUI at ${url} did not answer` },
    }
  }

  override async gpuUp(): Promise<GpuStatus> {
    const pool = this.gpuPool
    if (pool !== undefined) {
      await pool.ensure()
      return pool.current()
    }
    const url = this.staticComfyUrl
    if (url === undefined) {
      throw new Error('h3-video: no cloud GPU is configured (set comfy.gpu.gpuSpecUuid and its image, token, and start command)')
    }
    if (!await probeComfy(url)) {
      throw new Error(
        `h3-video: the static ComfyUI backend at ${url} is not reachable — start the instance, then retry`,
      )
    }
    return {
      configured: true,
      vendor: 'static',
      serviceUrl: url,
      state: 'running',
    }
  }

  override async gpuDown(mode: 'stop' | 'release'): Promise<GpuStatus> {
    const pool = this.gpuPool
    if (pool === undefined) {
      if (this.staticComfyUrl !== undefined) {
        throw new Error(
          `h3-video: the local ComfyUI backend uses the static address ${this.staticComfyUrl}; `
          + 'power that instance off where it runs, not through video_gpu',
        )
      }
      throw new Error('h3-video: no cloud GPU is configured (set comfy.gpu.gpuSpecUuid and its image, token, and start command)')
    }
    return mode === 'release' ? await pool.release() : await pool.stop()
  }

  /**
   * Release one settled local task's hold on the GPU idle timer; other backends have no instance.
   * @param target - the routed provider that served the task.
   * @param ref - the settled task reference.
   */
  private settleLocalTask(target: RoutedProvider, ref: H3TaskRef): void {
    if (target.choice !== 'local') return
    if (!this.liveLocalTasks.delete(String(ref))) return
    this.gpuPool?.taskFinished()
  }
}

export default LocalH3Video
