/**
 * Desktop composition-dependency gate: every package the desktop composition
 * names (base bundle + web-app bundle + the desktop overlay) must be reachable
 * from `apps/desktop`'s production dependency closure, because electron-builder
 * ships exactly that closure — a composition row naming a package outside it
 * boots as a dead row on the packaged desktop (the plugin loader cannot
 * resolve the package), which surfaces as a silently missing feature.
 *
 * Exemptions: rows disabled in a patch (the shipped disabled `ui-schedule`
 * pair) and the two staged non-workspace plugins (`@xmanrui/dsh-im`,
 * `business-entry`) that `apps/desktop/scripts/deploy-app.mjs` copies beside
 * the bundle instead of through node_modules.
 * @module scripts/verify-desktop-dependencies
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()

/** The patch files whose `name:` rows compose the desktop host tree. */
const COMPOSITION_PATCHES = [
  'packages/bundle/base/cordis.patch.yml',
  'packages/bundle/web-app/cordis.patch.yml',
  'apps/desktop/cordis.patch.yml',
]

/**
 * Packages staged by deploy-app.mjs beside the bundle instead of shipping
 * through node_modules, so the dependency closure does not carry them.
 */
const STAGED_EXEMPTIONS = new Set<string>(['@xmanrui/dsh-im', 'business-entry'])

/** Rows listing `disabled: true` within this many lines after `- name:` never load. */
const DISABLED_SCAN_LINES = 4

/** Loader row name shape: `name: '<package or package/subpath>'`. */
const ROW_NAME = /name: '([^']+)'/

interface CompositionRow {
  readonly pkg: string
  readonly patch: string
  readonly disabled: boolean
}

/**
 * Extract every `name:` package from one patch file. A row block's `name:`
 * sits on its own indented line; a following `disabled: true` (scanned a few
 * lines down) keeps the row out of the packaged composition.
 * @param patch - Repository-relative patch path.
 * @returns the named rows with their disabled flags.
 */
function compositionRows(patch: string): CompositionRow[] {
  const lines = readFileSync(join(repoRoot, patch), 'utf8').split(/\r?\n/)
  const rows: CompositionRow[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = (lines[index] ?? '').match(ROW_NAME)
    if (match === null || match[1] === undefined) continue
    const rest = lines.slice(index + 1, index + 1 + DISABLED_SCAN_LINES).join('\n')
    rows.push({
      pkg: packageRoot(match[1]),
      patch,
      disabled: /^\s*disabled: true/m.test(rest),
    })
  }
  return rows
}

/**
 * Reduce one loader name to its package root: a scoped name keeps two
 * segments, a bare name keeps one.
 * @param name - Loader row name, possibly with a subpath (`@scope/pkg/sub`).
 * @returns the package name.
 */
function packageRoot(name: string): string {
  if (name.startsWith('@')) {
    const segments = name.split('/')
    return segments.length >= 2 ? `${segments[0] ?? ''}/${segments[1] ?? ''}` : name
  }
  return name.split('/')[0] ?? name
}

/**
 * Walk the production dependency closure electron-builder ships: BFS over
 * `dependencies` (devDependencies excluded by the packager manifest) starting
 * at apps/desktop's direct dependencies, resolving every workspace or npm
 * package through the desktop install first, then the root install.
 * @returns the reachable package-name set.
 */
function packagingClosure(): Set<string> {
  const desktopManifest = JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const closure = new Set<string>()
  const queue = Object.keys(desktopManifest.dependencies ?? {})
  const manifestOf = (name: string): { dependencies?: Record<string, string> } | undefined => {
    for (const base of ['apps/desktop/node_modules', 'node_modules']) {
      const manifestPath = join(repoRoot, base, name, 'package.json')
      if (existsSync(manifestPath)) {
        return JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
      }
    }
    return undefined
  }
  while (queue.length > 0) {
    const name = queue.pop() ?? ''
    if (closure.has(name)) continue
    closure.add(name)
    const manifest = manifestOf(name)
    for (const dependency of Object.keys(manifest?.dependencies ?? {})) queue.push(dependency)
  }
  return closure
}

const rows = COMPOSITION_PATCHES.flatMap(compositionRows)
const closure = packagingClosure()
const isExempt = (pkg: string): boolean => STAGED_EXEMPTIONS.has(pkg)
const missing = new Map<string, string[]>()
for (const row of rows) {
  if (row.disabled || isExempt(row.pkg) || closure.has(row.pkg)) continue
  const patches = missing.get(row.pkg) ?? []
  if (!patches.includes(row.patch)) patches.push(row.patch)
  missing.set(row.pkg, patches)
}

if (missing.size > 0) {
  const lines = [...missing.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pkg, patches]) => `  ${pkg}  (named in ${patches.join(', ')})`)
  console.error(`verify-desktop-dependencies: ${missing.size} composition package(s) are unreachable from apps/desktop's production dependency closure and would boot as dead rows on the packaged desktop. Add them to apps/desktop/package.json dependencies (or disable the composition row):\n${lines.join('\n')}`)
  process.exit(1)
}
console.error(`verify-desktop-dependencies: ${rows.length} composition row(s) checked against a ${closure.size}-package production closure, all reachable.`)
