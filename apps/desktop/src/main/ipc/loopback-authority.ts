/**
 * The synthetic loopback authority every shell-carrier request is built under.
 * The desktop keeps IPC and the app scheme as its only carriers, so nothing
 * listens on this origin: it exists so a root-relative resource URL
 * (`/plugins/...`, `/api/...`) has an absolute base to resolve against, and so
 * the Host header it produces classifies as this process's own renderer under
 * the shared-channel trust fence.
 * @module @deepseek-ai/dsh-desktop/ipc/loopback-authority
 */

/** Origin of the synthetic authority; no listener is implied. */
export const LOOPBACK_AUTHORITY = 'http://127.0.0.1'

/**
 * Absolute loopback URL for one client-bundle route.
 * Index rows are document-relative (`plugins/...`); the app scheme and IPC
 * also pass root-relative (`/plugins/...`).
 * @param src - a bundle route from an injection row or a loadBundle request.
 * @returns the loopback URL, or `undefined` when `src` is not a plugin route.
 */
export function pluginBundleRequestUrl(src: string): string | undefined {
  const route = src.startsWith('/plugins/') ? src : src.startsWith('plugins/') ? `/${src}` : undefined
  if (route === undefined) return undefined
  return new URL(route, LOOPBACK_AUTHORITY).href
}
