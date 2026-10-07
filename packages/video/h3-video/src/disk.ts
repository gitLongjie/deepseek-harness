/**
 * Free-space probe for the video output volume, used to refuse generation before a download can
 * fill the disk.
 * @module @deepseek-ai/dsh-h3-video/disk
 */

import { statfs } from 'node:fs/promises'

/**
 * Query the free bytes on the volume holding `path`. Uses `fs.statfs`, which resolves the block
 * accounting on Windows and POSIX alike (available blocks × block size).
 * @param path - any path on the target volume; need not exist yet.
 * @returns the free bytes, or `undefined` when the volume cannot be queried.
 */
export async function diskFreeBytes(path: string): Promise<number | undefined> {
  try {
    const stats = await statfs(path)
    return stats.bavail * stats.bsize
  } catch {
    return undefined
  }
}
