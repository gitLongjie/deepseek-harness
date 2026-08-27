/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-login`.
 * @module @deepseek-ai/dsh-client-ui-login/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-login'

/** Cordis companion plugin name. */
export const name = 'client-ui-login-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer plugin registering one presentational
 * component into the host-declared sidebar footer-action slot plus its locale
 * dictionaries — its state lives in the component-owned session store, it
 * emits no cordis events, and it owns no cross-plugin mutable state.
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
