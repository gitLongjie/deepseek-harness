/**
 * Boot-phase diagnostic logging for the client boot chain. The desktop shell
 * mirrors renderer console info lines that carry the `[boot]` prefix into its
 * desktop.log (a packaged GUI run has no stderr sink) and mirrors warning and
 * error lines unconditionally, so boot progress and stall snapshots remain
 * diagnosable on machines where the window is the only surface.
 * @module @deepseek-ai/dsh-client-web/src/boot-log
 */

/** Boot clock start: the first import of this module in the page. */
const startedAt = performance.now()

/**
 * Emit one boot progress line at info level, prefixed `[boot]` and stamped
 * with the elapsed boot time in milliseconds.
 * @param message - line body without the prefix.
 */
export function bootLog(message: string): void {
  console.info(`[boot] ${Math.round(performance.now() - startedAt)}ms ${message}`)
}

/**
 * Emit one boot stall line at warning level. The desktop shell mirrors
 * warnings unconditionally, so stall snapshots stay visible even on surfaces
 * that never see info lines.
 * @param message - line body without the prefix.
 */
export function bootWarn(message: string): void {
  console.warn(`[boot] ${Math.round(performance.now() - startedAt)}ms ${message}`)
}
