/**
 * Failure type shared by the geo-admin tools: one error class so a caller can
 * tell a missing configuration apart from a rejected request.
 * @module @deepseek-ai/dsh-tool-geo-admin/errors
 */

/**
 * Why a geo-admin call could not proceed.
 *
 * - `unconfigured`: the settings page carries no base URL or account, or no
 *   password is stored under the credential reference.
 * - `unavailable`: the deployment mounts no `geo-admin` settings entry.
 * - `http`: the backend answered with a non-success status, or the request
 *   could not be completed (network failure, timeout, refused redirect).
 * - `response`: the backend answered with a body this client cannot read.
 */
export type GeoAdminErrorCode = 'unconfigured' | 'unavailable' | 'http' | 'response'

/** A geo-admin failure carrying which part of the exchange produced it. */
export class GeoAdminError extends Error {
  /**
   * @param code - the failure class, for callers that branch on it.
   * @param message - a complete sentence naming what to fix or retry.
   */
  constructor(readonly code: GeoAdminErrorCode, message: string) {
    super(message)
    this.name = 'GeoAdminError'
  }
}
