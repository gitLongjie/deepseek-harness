/**
 * Host-plane settings entry for the H3 video seam: registers the `h3-video`
 * settings namespace and publishes its live value as the `h3VideoSettings`
 * service. The namespace is the USER layer over whatever the composition
 * carries; the in-preset {@link H3Video} service resolves the two into its
 * effective configuration, so a value changed here takes effect without
 * editing the preset's composition file.
 *
 * This entry is a HOST row: `settings.register` is a once-per-process
 * ownership registration, so it must never be mounted from a preset (a second
 * session mounting the same preset would collide). The published view is what
 * a preset-mounted service consumes — service resolution crosses the isolate
 * realm, `settings` scope handles do not.
 * @module @deepseek-ai/dsh-h3-video/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Settings namespace carrying the user-tunable H3 video configuration. */
export const H3_VIDEO_SETTINGS_NAMESPACE = 'h3-video'

/** The user-tunable slice of the H3 video configuration. Flat on purpose: the
 * settings card is a flat form, and the overlay resolve step in the service
 * maps these names onto the composition's `comfy`/`minimax` rows. Every field
 * is optional; an absent field inherits the composition value. */
export interface H3VideoSettingsSection {
  /** Local ComfyUI base URL, e.g. `http://127.0.0.1:8188`. */
  comfyUrl?: string
  /** Local ComfyUI API workflow template path; a value here enables the local backend when the composition carries none. */
  comfyWorkflowPath?: string
  /** Local ComfyUI input directory for reference assets. */
  comfyInputDir?: string
  /** Local ComfyUI poll interval in milliseconds. */
  comfyPollIntervalMs?: number
  /** Local ComfyUI task timeout in milliseconds. */
  comfyTaskTimeoutMs?: number
  /** Local ComfyUI concurrent task limit. */
  comfyMaxConcurrency?: number
  /** Resolutions the local backend accepts. */
  comfyResolutions?: string[]
  /** Shortest segment the local backend accepts, in seconds. */
  comfyMinDurationSeconds?: number
  /** Longest segment the local backend accepts, in seconds. */
  comfyMaxDurationSeconds?: number
  /** Hosted MiniMax API base URL. */
  minimaxBaseUrl?: string
  /** Hosted MiniMax video model release id; unknown ids need the envelope fields below. */
  minimaxModel?: string
  /** Resolutions the hosted model accepts; overrides the published envelope for the model. */
  minimaxResolutions?: string[]
  /** Shortest segment the hosted model accepts, in seconds. */
  minimaxMinDurationSeconds?: number
  /** Longest segment the hosted model accepts, in seconds. */
  minimaxMaxDurationSeconds?: number
  /** Credential reference resolving the hosted API key; a value here enables the remote backend when the composition carries no key. */
  minimaxApiKeyRef?: string
  /** Hosted MiniMax poll interval in milliseconds. */
  minimaxPollIntervalMs?: number
  /** Hosted MiniMax task timeout in milliseconds. */
  minimaxTaskTimeoutMs?: number
  /** Hosted MiniMax concurrent task limit. */
  minimaxMaxConcurrency?: number
  /** Download directory for generated segments; supports `~`. */
  outputDir?: string
  /** Output-volume free-space floor in megabytes. */
  minFreeSpaceMb?: number
  /** Disk-usage estimate for the output-volume preflight, bytes per second of video. */
  estimatedBytesPerSecond?: number
}

/** Loader schema for the `h3-video` settings namespace. */
export const H3VideoSettingsSchema: z<H3VideoSettingsSection> = z.object({
  comfyUrl: z.string(),
  comfyWorkflowPath: z.string(),
  comfyInputDir: z.string(),
  comfyPollIntervalMs: z.number().min(500),
  comfyTaskTimeoutMs: z.number().min(60_000),
  comfyMaxConcurrency: z.number().step(1).min(1),
  comfyResolutions: z.array(z.union(['480P', '768P', '2K'] as const)),
  comfyMinDurationSeconds: z.number().step(1).min(1),
  comfyMaxDurationSeconds: z.number().step(1).min(1),
  minimaxBaseUrl: z.string(),
  minimaxModel: z.string(),
  minimaxResolutions: z.array(z.union(['480P', '768P', '2K'] as const)),
  minimaxMinDurationSeconds: z.number().step(1).min(1),
  minimaxMaxDurationSeconds: z.number().step(1).min(1),
  minimaxApiKeyRef: z.string(),
  minimaxPollIntervalMs: z.number().min(1_000),
  minimaxTaskTimeoutMs: z.number().min(60_000),
  minimaxMaxConcurrency: z.number().step(1).min(1),
  outputDir: z.string(),
  minFreeSpaceMb: z.number().step(1).min(0),
  estimatedBytesPerSecond: z.number().min(1),
}) as z<H3VideoSettingsSection>

/** Live view of the `h3-video` settings section, published on the host plane. */
export interface H3VideoSettingsView {
  /**
   * Read the currently committed section value.
   * @returns the committed settings section.
   */
  get(): H3VideoSettingsSection
  /**
   * Observe committed changes to the section.
   * @param callback - invoked with the next committed value.
   * @returns the disposer removing this observer.
   */
  watch(callback: (next: H3VideoSettingsSection) => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live view of the `h3-video` settings namespace; present while the host settings entry is mounted. */
    h3VideoSettings: H3VideoSettingsView
  }
}

/** Services the host settings entry requires. */
export const inject = ['settings'] as const

/**
 * Register the `h3-video` settings namespace and publish its live view.
 * @param ctx - host plugin context.
 * @param config - composition-carried base section layered under user edits.
 */
export function apply(ctx: Context, config: H3VideoSettingsSection): void {
  const scope = ctx.settings.register(H3_VIDEO_SETTINGS_NAMESPACE, H3VideoSettingsSchema, { base: config })
  const watchers = new Set<(next: H3VideoSettingsSection) => void>()
  ctx.effect(
    () => scope.watch((next) => { for (const watch of watchers) watch(next) }),
    'h3-video/settings: section fan-out',
  )
  ctx.effect(
    () => ctx.provide('h3VideoSettings', {
      get: () => scope.get(),
      watch: (callback: (next: H3VideoSettingsSection) => void) => {
        watchers.add(callback)
        return () => { watchers.delete(callback) }
      },
    } satisfies H3VideoSettingsView),
    'h3-video/settings: live view',
  )
}
