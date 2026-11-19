/**
 * Path prefixes the desktop scheme forwards to the in-process Host web server.
 * The renderer origin is `dshapp://`, so these routes are not files in the
 * web dist and are not the IPC `/api` transport.
 */
const WEB_HOST_PROXY_PREFIXES = ['/open-in-app/', '/_skin/'] as const

/**
 * Whether a desktop-scheme pathname belongs to the Host web server.
 * @param pathname - URL pathname from the application scheme.
 * @returns true when the shell should proxy the request to the loopback Host.
 */
export function isWebHostProxyPath(pathname: string): boolean {
  return WEB_HOST_PROXY_PREFIXES.some(prefix => pathname.startsWith(prefix))
}
