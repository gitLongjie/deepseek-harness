/** Packaged metadata used to resolve the desktop update feed. */
export interface DesktopUpdateManifest {
  dsh?: {
    updateUrl?: unknown
    localUpdateTest?: unknown
  }
}

/**
 * Resolve an update feed while keeping the HTTP exception limited to marked
 * local-update rehearsal packages and loopback hosts.
 * @param explicit - Optional environment override for the update feed.
 * @param manifest - Parsed packaged application metadata.
 * @returns The validated desktop update feed URL.
 */
export function resolveDesktopUpdateUrl(
  explicit: string | undefined,
  manifest: DesktopUpdateManifest,
): string {
  const value: unknown = explicit ?? manifest.dsh?.updateUrl
  if (typeof value !== 'string') throw new Error('desktop: OEM update URL is missing')
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return value
    if (manifest.dsh?.localUpdateTest === true
      && url.protocol === 'http:'
      && isLoopbackHostname(url.hostname)) return value
  } catch {
    // The diagnostic below owns malformed and disallowed values.
  }
  throw new Error('desktop: OEM update URL must be HTTPS')
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}
