/**
 * Host-plane settings entry for the geo-admin tools: registers the `geo-admin`
 * namespace (backend base URL and publishing account) and publishes its live
 * value as the `geoAdminSettings` service. The namespace is the USER layer over
 * whatever the composition carries, so a value changed on the settings page
 * takes effect on the next tool call without editing a composition file.
 *
 * The password never enters this section: it is stored through the credentials
 * domain under {@link GEO_ADMIN_PASSWORD_REF} and resolved per request, so the
 * literal rides no settings document and no tool result.
 *
 * This entry is a HOST row: `settings.register` is a once-per-process ownership
 * registration, so it must never be mounted from a preset (a second session
 * mounting the same preset would collide). The published view is what a
 * preset-mounted tool consumes.
 * @module @deepseek-ai/dsh-tool-geo-admin/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Settings namespace carrying the backend address and publishing account. */
export const GEO_ADMIN_SETTINGS_NAMESPACE = 'geo-admin'

/**
 * Credential reference resolving the publishing account's password. Both the
 * settings card and the tools address the same name; a launching environment
 * variable of this name also satisfies it.
 */
export const GEO_ADMIN_PASSWORD_REF = 'GEO_ADMIN_PASSWORD'

/** The user-tunable slice of the geo-admin configuration. Flat on purpose: the
 * settings card is a flat form, and the tools read each field where the request
 * is built. Every field is optional; an absent field inherits the composition
 * value, and a field that is still absent fails loud at call time. */
export interface GeoAdminSettingsSection {
  /** Backend origin, e.g. `http://localhost:8001`. */
  baseUrl?: string
  /** Account the tools sign in as; the password is the credential reference above. */
  username?: string
}

/** Loader schema for the `geo-admin` settings namespace. */
export const GeoAdminSettingsSchema: z<GeoAdminSettingsSection> = z.object({
  baseUrl: z.string(),
  username: z.string(),
})

/** Live view of the `geo-admin` settings section, published on the host plane. */
export interface GeoAdminSettingsView {
  /**
   * Read the currently committed section value.
   * @returns the committed settings section.
   */
  get(): GeoAdminSettingsSection
  /**
   * Observe committed changes to the section.
   * @param callback - invoked with the next committed value.
   * @returns the disposer removing this observer.
   */
  watch(callback: (next: GeoAdminSettingsSection) => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live view of the `geo-admin` settings namespace; present while the host settings entry is mounted. */
    geoAdminSettings: GeoAdminSettingsView
  }
}

/** Services the host settings entry requires. */
export const inject = ['settings'] as const

/**
 * Register the `geo-admin` settings namespace and publish its live view.
 * @param ctx - host plugin context.
 * @param config - composition-carried base section layered under user edits.
 */
export function apply(ctx: Context, config: GeoAdminSettingsSection): void {
  const scope = ctx.settings.register(GEO_ADMIN_SETTINGS_NAMESPACE, GeoAdminSettingsSchema, { base: config })
  const watchers = new Set<(next: GeoAdminSettingsSection) => void>()
  ctx.effect(
    () => scope.watch((next) => { for (const watch of watchers) watch(next) }),
    'geo-admin/settings: section fan-out',
  )
  ctx.effect(
    () => ctx.provide('geoAdminSettings', {
      get: () => scope.get(),
      watch: (callback: (next: GeoAdminSettingsSection) => void) => {
        watchers.add(callback)
        return () => { watchers.delete(callback) }
      },
    } satisfies GeoAdminSettingsView),
    'geo-admin/settings: live view',
  )
}
