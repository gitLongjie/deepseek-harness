/**
 * Public file-reference discovery records. This module contains types only so
 * generated Remote clients can consume it without Host runtime code.
 * @module @deepseek-ai/dsh-file-reference/types
 */

/** One path-only completion candidate inside the target session cwd. */
export interface FileReferenceCandidate {
  /** User-facing path accepted by normal prompts and filesystem tools. */
  path: string
  /** Directories keep completion open; files finish the mention. */
  kind: 'file' | 'directory'
}

/** Request to store one externally sourced file inside the target session workspace. */
export interface FileImportRequest {
  /** Bare file name proposed for the stored copy; path separators are rejected. */
  readonly name: string
  /** Canonical base64 encoding of the file bytes. */
  readonly data: string
}

/** Stored import referenced the same way `@` file mentions address workspace files. */
export interface FileImportValue {
  /** Workspace-relative path of the stored copy, always forward slashes. */
  readonly path: string
}
