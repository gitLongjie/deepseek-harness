/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-kb-weknora`.
 * @module @deepseek-ai/dsh-kb-weknora/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-kb-weknora'

/** Cordis companion plugin name. */
export const name = 'kb-weknora-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider owns no long-lived registered state —
 * every call performs one bounded fetch against the configured deployment
 * and contract-checks its own response.
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
