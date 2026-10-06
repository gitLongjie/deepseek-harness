/**
 * The H3 video provider seam: backend-neutral segment generation over a local ComfyUI deployment
 * or the hosted MiniMax V2 API, with explicit routing and ffmpeg assembly. This package's default
 * export is the {@link H3Video} Service class; loading it as a Cordis plugin registers the service
 * on `ctx.h3Video` from validated configuration. Misconfiguration fails loud at load.
 * @module @deepseek-ai/dsh-experimental-h3-video
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
import { resolve as routeRequest } from './routing.ts'
import type { BackendChoice, RoutedProvider } from './routing.ts'
import { assembleVideo } from './assembly.ts'
import type { AssemblyOptions, AssemblySegment } from './assembly.ts'
import type { H3TaskRef, ProviderCapabilities, SegmentRequest, TaskStatus } from './types.ts'
import type { H3VideoSettingsSection } from './settings.ts'

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

declare module '@deepseek-ai/cordis' {
  interface Context {
    h3Video: H3Video
  }
}

const RESOLUTIONS = ['480P', '768P', '2K'] as const

/** Local ComfyUI backend row. */
export interface ComfyConfig {
  /** ComfyUI server origin. */
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
    url: z.string().default('http://127.0.0.1:8188'),
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

  /** Static limits of one configured backend. @param choice - routing label. */
  abstract capabilities(choice: Exclude<BackendChoice, 'auto'>): ProviderCapabilities | undefined

  /**
   * Validate one request against one backend without submitting it.
   * @param choice - routing policy to check.
   * @param request - candidate segment request.
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
   * @param prompt - shot description, at most 1500 characters.
   * @param ratio - output aspect ratio.
   * @param signal - cancellation of the keyframe generation.
   * @returns the absolute path of the downloaded keyframe file.
   */
  abstract keyframe(prompt: string, ratio: KeyframeRequest['ratio'], signal: AbortSignal): Promise<string>

  /**
   * Concatenate ordered segment files into one mp4.
   * @param segments - ordered files.
   * @param options - output location and optional ffmpeg override.
   */
  abstract assemble(segments: readonly AssemblySegment[], options: AssemblyOptions): Promise<string>
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
  const comfy = base.comfy === undefined && Object.keys(comfyOverlay).length === 0
    ? undefined
    : { ...base.comfy, ...comfyOverlay }
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

/** The in-process {@link H3Video} over configured backends. */
class LocalH3Video extends H3Video {
  static inject = [] as const
  static Config = Config

  private providersList: readonly RoutedProvider[] = []
  private imageProvider: ReturnType<typeof createMiniMaxImageProvider> | undefined
  private outputDirectory: string = ''

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // The host-plane settings view, absent when the deployment mounts no
    // `./settings` entry (unit tests, minimal hosts). The overlay resolves
    // BEFORE the first build, so a mounted preset serves the committed values
    // from its first request.
    const view = ctx.get('h3VideoSettings')
    this.build(view === undefined ? config : resolveOverlayConfig(config, view.get()))
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
    if (comfy !== undefined) {
      const workflowPath = comfy.workflowPath
      if (typeof workflowPath === 'string' && workflowPath.length > 0) {
        const options: ComfyUIOptions = {
          baseUrl: comfy.url ?? 'http://127.0.0.1:8188',
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
        const credentials = this.ctx.get('credentials')
        if (credentials === undefined) {
          throw new Error('h3-video: minimax.apiKeyRef requires the credentials service (load @deepseek-ai/dsh-credentials-local)')
        }
        const ref = credentialRef(apiKeyRef)
        apiKeySource = async () => {
          const resolved = await credentials.resolve(ref)
          if (resolved === undefined) {
            throw new Error(
              `h3-video: credential ${apiKeyRef} is not configured (store it via the credentials service or the ${apiKeyRef} environment variable)`,
            )
          }
          return resolved.value
        }
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
      this.imageProvider = createMiniMaxImageProvider({
        apiKey: apiKeySource,
        baseUrl,
        model: (mm.imageModel ?? 'image-01') as MiniMaxImageOptions['model'],
        outputDir: join(outputDir, 'keyframes'),
        minFreeSpaceBytes,
      })
    }
    this.providersList = providers
  }

  override get providers(): readonly RoutedProvider[] {
    return this.providersList
  }

  override get outputDir(): string {
    return this.outputDirectory
  }

  override async keyframe(prompt: string, ratio: KeyframeRequest['ratio'], signal: AbortSignal): Promise<string> {
    if (this.imageProvider === undefined) {
      throw new Error('h3-video: keyframe generation needs the remote backend (configure minimax.apiKey or minimax.apiKeyRef)')
    }
    return this.imageProvider.generate({ prompt, ratio }, signal)
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
    const ref = await resolved.provider.submit(request, signal)
    return { target: { choice: resolved.choice, provider: resolved.provider }, ref }
  }

  override poll(target: RoutedProvider, ref: H3TaskRef, signal: AbortSignal): Promise<TaskStatus> {
    return target.provider.poll(ref, signal)
  }

  override cancel(target: RoutedProvider, ref: H3TaskRef): Promise<void> {
    return target.provider.cancel(ref)
  }

  override assemble(segments: readonly AssemblySegment[], options: AssemblyOptions): Promise<string> {
    return assembleVideo(segments, options)
  }
}

export default LocalH3Video
