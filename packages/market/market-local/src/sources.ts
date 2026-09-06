/**
 * The durable market source registry: one JSON document in the Harness home
 * holding the configured sources and the current selection. Seeding happens on
 * first read only; a corrupt document fails loud instead of being rewritten.
 * @module @deepseek-ai/dsh-market-local/sources
 */

import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { MarketSourceId } from '@deepseek-ai/dsh-market'
import { DEFAULT_SOURCE_ATTRIBUTION, describeZodIssues, storedSourcesSchema, type StoredSourcesFile } from './schemas.ts'

/** The built-in seed source registered on first read of a fresh registry. */
export const DEFAULT_SOURCE_URL = 'https://deepseek1024.com/api/v1/plugins'

/** The built-in seed source's stable local identity. */
export const DEFAULT_SOURCE_ID = 'dsh-1024store'

/** Read the source registry, seeding the built-in default source when absent. */
export async function readSourcesFile(home: string): Promise<StoredSourcesFile> {
  const path = sourcesFilePath(home)
  if (!existsSync(path)) {
    const seeded: StoredSourcesFile = {
      schema: 1,
      selected: DEFAULT_SOURCE_ID,
      sources: [{
        id: DEFAULT_SOURCE_ID as MarketSourceId,
        name: DEFAULT_SOURCE_ATTRIBUTION.name,
        kind: 'store-v1',
        url: DEFAULT_SOURCE_URL,
        attribution: DEFAULT_SOURCE_ATTRIBUTION,
      }],
    }
    await writeSourcesFile(home, seeded)
    return seeded
  }
  const raw = await withFileLock(path, async () => await readFile(path, 'utf8'))
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch (error) {
    throw new Error(`market-local: ${path} is not valid JSON: ${String(error)}`)
  }
  const parsed = storedSourcesSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`market-local: ${path} is not a valid source registry: ${describeZodIssues(parsed.error)}`)
  }
  // The persisted document is plain JSON; validation rebrands ids and drops
  // the wire-optional undefined from attribution in this one owning cast.
  return parsed.data as unknown as StoredSourcesFile
}

/**
 * Persist the source registry atomically under a file lock. Owner-only
 * permission bits: the registry is user-private Harness-home state.
 * @param home - the Harness home.
 * @param state - the registry state to store.
 */
export async function writeSourcesFile(home: string, state: StoredSourcesFile): Promise<void> {
  const path = sourcesFilePath(home)
  // The lock file must be creatable before the atomic write creates anything.
  mkdirSync(join(home, 'market'), { recursive: true, mode: 0o700 })
  await withFileLock(path, () => writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 }))
}

/**
 * Create a new source identity.
 * @returns a fresh registry-safe source id.
 */
export function newSourceId(): string {
  return randomUUID()
}

function sourcesFilePath(home: string): string {
  return join(home, 'market', 'sources.json')
}
