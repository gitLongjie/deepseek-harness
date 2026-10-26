/**
 * Structural tests for the shipped desktop preset compositions: a group that
 * isolates a service behind an entry-local realm must provide that service
 * from INSIDE the group, because the realm hides any host-plane provider from
 * the group's rows. The regression these tests pin: the delegation groups
 * lost their workflow engine row when `dsh-workflow-worker-thread` was
 * deleted, and `tool-workflow`/`tool-ralph` waited forever for
 * `workflowEngine`, so every fresh mount of those presets was refused.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

/** The engine provider packages that exist on this branch, by service name. */
const REALM_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  workflowEngine: ['@deepseek-ai/dsh-workflow-ptc'],
}

/** Package names deleted from the workspace that compositions must not name. */
const GHOST_PACKAGES = ['@deepseek-ai/dsh-workflow-worker-thread']

/** One composition row as parsed from a preset file. */
interface Row {
  readonly id?: unknown
  readonly name?: unknown
  readonly group?: unknown
  readonly isolate?: unknown
  readonly config?: unknown
}

/** Flatten a composition's rows, descending into groups, labeling each with its group path. */
function rowsOf(rows: readonly unknown[], group = ''): Array<{ row: Row; group: string }> {
  const out: Array<{ row: Row; group: string }> = []
  for (const entry of rows) {
    const row = entry as Row
    out.push({ row, group })
    if (row.group === true && Array.isArray(row.config)) {
      out.push(...rowsOf(row.config as readonly unknown[], row.id === undefined ? group : String(row.id)))
    }
  }
  return out
}

describe('shipped desktop preset compositions', () => {
  const files = readdirSync(ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(ROOT, entry.name, 'agent.cordis.yml'))

  it('ships at least one preset composition', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const path of files) {
    const label = path.replaceAll('\\', '/').split('/').at(-2)
    it(`${label}: every realm-isolated service is provided inside its own group`, () => {
      const rows = rowsOf(load(readFileSync(path, 'utf8'), { schema: entryListSchema }) as readonly unknown[])
      for (const { row } of rows) {
        if (row.group !== true) continue
        const isolated = row.isolate
        if (isolated === undefined || typeof isolated !== 'object' || isolated === null) continue
        for (const service of Object.keys(isolated as Record<string, unknown>)) {
          const providers = REALM_PROVIDERS[service]
          if (providers === undefined) continue
          const names = (Array.isArray(row.config) ? row.config as readonly Row[] : [])
            .map(child => typeof child.name === 'string' ? child.name : '')
          const provided = providers.some(provider => names.includes(provider))
          expect(provided, `${label}: group "${String(row.id ?? '?')}" isolates ${service} but no row inside provides it (${providers.join(', ')})`).toBe(true)
        }
      }
    })

    it(`${label}: names no deleted package`, () => {
      const content = readFileSync(path, 'utf8')
      for (const ghost of GHOST_PACKAGES) {
        expect(content.includes(ghost), `${label}: names deleted package ${ghost}`).toBe(false)
      }
    })
  }
})
