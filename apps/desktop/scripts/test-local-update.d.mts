/** Type declarations for the local packaged-update rehearsal script. */

export function parseLocalUpdateArgs(args: readonly string[]): {
  baseVersion: string
  port: number
  updateVersion: string
}

export function localUpdateBuildEnvironment(
  version: string,
  updateUrl: string,
  output: string,
): NodeJS.ProcessEnv

export function readUpdateFeed(root: string, expectedVersion: string): {
  artifact: string
  version: string
}

export function materializeLocalPublisherNames(root: string, expectedVersion: string): void

export function resolveFeedRequest(root: string, pathname: string): string | undefined

export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined

export function serveFeed(root: string, port: number): unknown
