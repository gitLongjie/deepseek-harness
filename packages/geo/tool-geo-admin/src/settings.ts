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
 * Mount this shared service once on the host; preset-mounted tools consume it.
 * @module @deepseek-ai/dsh-tool-geo-admin/settings
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
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
   * Persist supplied fields in the active profile.
   * @param patch Fields to save.
   * @returns Settlement after the profile edit is committed.
   */
  update(patch: GeoAdminSettingsSection): Promise<void>
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

/** Host plugin name. */
export const name = 'geo-admin-settings'

/** Services owning durable profile edits. */
export const inject = ['settings'] as const

/** Live configuration owned by the host plugin. */
export interface Config {
  /** Backend origin. */
  baseUrl: Volatile<string | undefined>
  /** Backend account name. */
  username: Volatile<string | undefined>
}

/** Editable fields exposed through the profile's configuration forms. */
export const Config = z.object({
  baseUrl: z.string().volatile(),
  username: z.string().volatile(),
})

/**
 * Publish the shared account configuration for preset-mounted tools.
 * @param ctx Host plugin context.
 * @param config Live configuration references.
 */
export function apply(ctx: Context, config: Config): void {
  const read = (): GeoAdminSettingsSection => {
    const baseUrl = config.baseUrl.get()
    const username = config.username.get()
    return {
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(username === undefined ? {} : { username }),
    }
  }
  const view: GeoAdminSettingsView = {
    get: read,
    update: patch => ctx.settings.update(GEO_ADMIN_SETTINGS_NAMESPACE, patch),
    watch: callback => ctx.on('settings/document-updated', (ns) => {
      if (ns === GEO_ADMIN_SETTINGS_NAMESPACE) {
        callback(read())
      }
    }),
  }
  ctx.provide('geoAdminSettings', view)
}
