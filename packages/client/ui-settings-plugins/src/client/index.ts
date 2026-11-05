/**
 * Built-in plugins settings section, browser half: the shell around the
 * feature-owned tabs registered into `settings.plugins.tab` (the read-only
 * inventory ships one). The configuration pages of the host-plane plugins
 * live in their own companion packages. This section also contributes the
 * shared GEO account card while its Host configuration is available.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section'
// entry). Cross-plugin collaboration goes through slots, never a value import
// (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginsSettingsSection } from './PluginsSettingsSection.tsx'
import type { PluginsSettingsSectionInjected, PluginsSettingsTabEntry } from './PluginsSettingsSection.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'
import { GeoAdminCard } from './GeoAdminCard.tsx'
import { GEO_ADMIN_NS, GeoAdminCardController, type GeoAdminSettings } from './geo-admin-card-controller.ts'

export type { PluginsSettingsSectionInjected, PluginsSettingsSectionProps } from './PluginsSettingsSection.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugins'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/**
 * Mount the built-in plugins section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-plugins: section dictionaries')

  ctx.inject(['configForms', 'remote'], (ctx) => {
    const card = new GeoAdminCardController(ctx.configForms.get<GeoAdminSettings>(GEO_ADMIN_NS), ctx)
    ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => {
      card.refreshCredential(ref)
    }), 'ui-settings-plugins: geo password status')
    ctx.effect(() => ctx.configForms.whileServed([GEO_ADMIN_NS], () =>
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab', id: GEO_ADMIN_NS, order: 10,
        label: () => t('geoTitle'), locale: NS, inject: () => card.inject(),
      }, GeoAdminCard))), 'ui-settings-plugins: geo account card')
  })

  let tabsVersion = -1
  let tabsRevision = -1
  let tabs: readonly PluginsSettingsTabEntry[] = []
  const sectionInjected = (): PluginsSettingsSectionInjected => ({
    hooks: {
      tabs: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.plugins.tab')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== tabsVersion || revision !== tabsRevision) {
            tabsVersion = version
            tabsRevision = revision
            tabs = ctx.slots.entries('settings.plugins.tab')
              .map(entry => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: entry.options.id ?? '',
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return tabs
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.plugins.tab', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
    },
  })

  // This package owns the one Built-in plugins navigation entry and the tab
  // chrome; feature plugins contribute pages without competing for Settings nav rows.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugins',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  }, PluginsSettingsSection))
}
