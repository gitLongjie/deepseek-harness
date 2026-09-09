/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-knowledge-base`.
 * @module @deepseek-ai/dsh-client-ui-knowledge-base/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-knowledge-base'

/** Cordis companion plugin name. */
export const name = 'client-ui-knowledge-base-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer plugin registering one presentational
 * section into the host-declared `sidebar.knowledge` slot plus its locale
 * dictionaries — its inject face is a read-only Remote projection; it emits
 * no cordis events and owns no cross-plugin mutable state.
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
