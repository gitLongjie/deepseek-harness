/**
 * The npm registry as the sole install-version authority: resolve one package's
 * `latest` manifest and reduce it to the facts installability needs.
 * @module @deepseek-ai/dsh-market-local/npm-registry
 */

import { fetchJsonBounded, type FetchJsonOptions } from './http.ts'
import { registryLatestSchema, type RegistryLatest } from './schemas.ts'

/** An exact stable version: three numeric release components, no prerelease or build tags. */
const STABLE_VERSION = /^\d+\.\d+\.\d+$/

/**
 * Read one package's `latest` manifest from the registry.
 * @param registryUrl - the registry base URL.
 * @param packageName - the npm package name (scoped names are encoded).
 * @param options - the transport bounds.
 * @returns the validated manifest facts, or undefined when the registry answer
 *   is missing fields or malformed — an unreadable answer never installs.
 */
export async function resolveRegistryLatest(
  registryUrl: string,
  packageName: string,
  options: FetchJsonOptions,
): Promise<RegistryLatest | undefined> {
  const encoded = encodeURIComponent(packageName).replace('%40', '@').replace('%2F', '%2f')
  const url = `${registryUrl.replace(/\/+$/, '')}/${encoded}/latest`
  let payload: unknown
  try {
    payload = await fetchJsonBounded(url, options)
  } catch {
    return undefined
  }
  const parsed = registryLatestSchema.safeParse(payload)
  return parsed.success ? parsed.data : undefined
}

/**
 * Whether a registry version is an exact stable release.
 * @param version - the version string from the registry.
 */
export function isExactStableVersion(version: string): boolean {
  return STABLE_VERSION.test(version)
}
