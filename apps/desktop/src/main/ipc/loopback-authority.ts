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
