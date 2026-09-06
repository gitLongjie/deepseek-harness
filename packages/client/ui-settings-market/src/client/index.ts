/** Plugin marketplace registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MarketSettingsTab, type MarketSettingsTabInjected } from './MarketSettingsTab.tsx'
import { en, zh, type MarketLocaleKey } from './locales.ts'

export type { MarketSettingsTabInjected, MarketSettingsTabProps } from './MarketSettingsTab.tsx'
export type { MarketLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin marketplace copy. */
    'settings.market': MarketLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.market'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.market']

/** Contribute the marketplace tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-market: dictionaries')

  const t = ctx.locale.bind(NS)
  type CallResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  const call = async <T>(namespace: string, operation: () => Promise<CallResult<T>>): Promise<T> => {
    const result = await operation()
    if (!result.ok) {
      throw new Error(`${namespace} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): MarketSettingsTabInjected => ({
    // Ids originate from this same Remote's browse and installed responses;
    // the unbranded component face rebrands at this assembly boundary.
    listSources: () => call('market.listSources', () => ctx.remote.market.listSources()),
    selectedSource: () => call('market.selectedSource', () => ctx.remote.market.selectedSource()).then(value => value.sourceId),
    selectSource: sourceId => call('market.selectSource', () => ctx.remote.market.selectSource({ sourceId: sourceId as never })).then(() => undefined),
    browse: query => call('market.browse', () => ctx.remote.market.browse({ query })),
    installability: ref => call('market.installability', () => ctx.remote.market.installability({ ref: ref as never })),
    install: ref => call('market.installEntry', () => ctx.remote.market.installEntry({ ref: ref as never })),
    installed: () => call('market.installed', () => ctx.remote.market.installed()),
    uninstall: bundleId => call('market.uninstall', () => ctx.remote.market.uninstall({ bundleId: bundleId as never })),
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'market',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, MarketSettingsTab))
}
