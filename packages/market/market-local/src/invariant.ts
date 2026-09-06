/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-market-local`.
 * @module @deepseek-ai/dsh-market-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-market-local'

/** Cordis companion plugin name. */
export const name = 'market-local-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider owns no long-lived registered state —
 * catalog caches are request-scoped projections, the source registry is read
 * from disk per operation, and profile mutations reconcile through the
 * app-boot helper that owns the layer-list contract.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
