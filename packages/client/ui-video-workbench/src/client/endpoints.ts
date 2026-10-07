/**
 * Same-origin endpoints of the host plugin's read-only routes. Spelled here so
 * the page and its tests share one URL builder.
 */

/** The projects-listing route the host plugin registers. */
export const WORKBENCH_PROJECTS_PATH = '/api/video-workbench/projects'

/** The single-file route's path prefix. */
const WORKBENCH_FILE_PATH = '/api/video-workbench/file'

/**
 * Build the same-origin URL of one served workbench file. The listing reports absolute paths
 * under the projected root; the route takes the path relative to that root, so the root prefix
 * is stripped here and separators normalize to `/`.
 * @param absolutePath - the absolute file path the listing reported.
 * @param outputDir - the projected root the listing named.
 * @returns the URL an `<img>`, `<video>`, or link element can use.
 */
export function workbenchFileUrl(absolutePath: string, outputDir: string): string {
  const asForward = (value: string): string => value.replace(/\\/gu, '/')
  const prefix = `${asForward(outputDir).replace(/\/+$/u, '')}/`
  const forward = asForward(absolutePath)
  const relative = forward.startsWith(prefix) ? forward.slice(prefix.length) : forward.replace(/^\/+/u, '')
  return `${WORKBENCH_FILE_PATH}?path=${encodeURIComponent(relative)}`
}
