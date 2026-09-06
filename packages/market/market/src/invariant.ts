/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-market`.
 * @module @deepseek-ai/dsh-market/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-market'

/** Cordis companion plugin name. */
export const name = 'market-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Service Definition owns abstract method signatures
 * only. Behavior invariants live with their owners — the local provider
 * asserts source-registry persistence, and the Remote gateway asserts the
 * wire projection.
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
