/**
 * Diagnostic request log for the H3 pipeline. Every image and video request appends one JSON line to
 * `<outputDir>/logs/h3-video.jsonl`, so "why is the character missing from this keyframe?" is a
 * question the log answers instead of a guess. Logging never fails a render.
 * @module @deepseek-ai/dsh-h3-video/log
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Append one request record.
 * @param outputDir - the h3-video output directory; the log lives under `logs/`.
 * @param kind - `keyframe` or `video`, the two request families.
 * @param fields - the facts worth keeping: which backend ran, what it was conditioned on, and the
 *   head of the prompt.
 * @returns completion; failures are swallowed because a log must never break a render.
 */
export async function logRequest(
  outputDir: string,
  kind: 'keyframe' | 'video',
  fields: Record<string, unknown>,
): Promise<void> {
  try {
    await mkdir(join(outputDir, 'logs'), { recursive: true })
    const line = `${JSON.stringify({ at: new Date().toISOString(), kind, ...fields })}\n`
    await appendFile(join(outputDir, 'logs', 'h3-video.jsonl'), line, 'utf8')
  } catch {
    // A read-only or full volume must not turn a diagnostic into a failure.
  }
}
