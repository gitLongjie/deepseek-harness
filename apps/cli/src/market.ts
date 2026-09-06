/**
 * `dsh market --profile <name> <subcommand>` — browse and manage profile
 * plugins through a market source without booting a Cordis tree. The runner
 * instantiates the LocalMarket service against a bare context (the CLI passes
 * the profile explicitly, so the launcher profile fact is not needed), renders
 * results as plain text on stdout, and reports failures on stderr with exit
 * code 1. Install and uninstall always end in a restart hint: a new bundle
 * layer activates on the next host start, never mid-session.
 * @module @deepseek-ai/dsh/market
 */

import { Context } from '@deepseek-ai/cordis'
import LocalMarket from '@deepseek-ai/dsh-market-local'
import type {
  MarketBrowseQuery,
  MarketBundleId,
  MarketEntryId,
  MarketEntryRef,
  MarketInstallOutcome,
  MarketInstallability,
  MarketInstalledPlugin,
  MarketSourceId,
  MarketSourceKind,
  MarketUninstallOutcome,
} from '@deepseek-ai/dsh-market'
import type { MarketSubcommand } from './args.ts'

const NAME = 'dsh'

/** Default page size for CLI search listing. */
const SEARCH_LIMIT = 50

function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`)
}

function writeStderr(line: string): void {
  process.stderr.write(`${NAME}: ${line}\n`)
}

function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`
}

/** Build the market service with the CLI-resolved profile. */
function buildMarket(profile: string): LocalMarket {
  const ctx = new Context()
  try {
    return new LocalMarket(ctx, { profile })
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/** The selected source's identity, or null after printing the selection hint. */
async function selectedRef(market: LocalMarket, entryId: string): Promise<MarketEntryRef | null> {
  const selected = await market.selectedSource()
  if (selected === null) {
    writeStderr('no source is selected — run: dsh market source select <sourceId>')
    return null
  }
  // The id is user-typed; the service resolves it against its own observed
  // cache and never accepts an install identity without a source match.
  return { sourceId: selected, entryId: entryId as MarketEntryId }
}

async function runSearch(market: LocalMarket, args: readonly string[]): Promise<void> {
  const query: MarketBrowseQuery = args.length > 0
    ? { query: args.join(' '), limit: SEARCH_LIMIT }
    : { limit: SEARCH_LIMIT }
  const page = await market.browse(query)
  const selected = await market.selectedSource()
  const source = (await market.listSources()).find(candidate => candidate.id === selected)
  writeStdout(`source: ${source === undefined ? '(none selected)' : `${source.name} <${source.id}>`}`)
  for (const entry of page.entries) {
    const identity = entry.npmPackage === undefined ? '' : `  [${entry.npmPackage}]`
    writeStdout(`${entry.entryId}  ${truncate(entry.name, 48)} — ${truncate(entry.summary, 80)}${identity}`)
  }
  if (page.entries.length === 0) writeStdout('(no entries matched)')
  if (page.nextCursor !== null && page.nextCursor !== undefined) {
    writeStdout(`— more pages: rerun with cursor ${page.nextCursor} —`)
  }
}

async function runView(market: LocalMarket, args: readonly string[]): Promise<void> {
  const ref = await selectedRef(market, args[0] ?? '')
  if (ref === null) return
  const entry = await market.entryDetail(ref)
  if (entry === undefined) {
    writeStderr(`source does not list entry ${ref.entryId}`)
    return
  }
  writeStdout(`${entry.name}  <${entry.entryId}>`)
  if (entry.summary !== '') writeStdout(truncate(entry.summary, 120))
  if (entry.description !== undefined) writeStdout(truncate(entry.description, 400))
  if (entry.npmPackage !== undefined) writeStdout(`npm package: ${entry.npmPackage}`)
  if (entry.latestVersion !== undefined) writeStdout(`source-reported version: ${entry.latestVersion}`)
  if (entry.publisher !== undefined) writeStdout(`publisher: ${entry.publisher}`)
  if (entry.categories.length > 0) writeStdout(`categories: ${entry.categories.join(', ')}`)
  if (entry.repository !== undefined) writeStdout(`repository: ${entry.repository}`)
  if (entry.homepage !== undefined) writeStdout(`homepage: ${entry.homepage}`)
  renderInstallability(await market.installability(ref))
}

function renderInstallability(installability: MarketInstallability): void {
  if (installability.installable) {
    writeStdout(`installable: yes (npm latest ${installability.resolvedVersion ?? 'unknown'})`)
    return
  }
  writeStdout('installable: no')
  for (const reason of installability.reasons) writeStdout(`  - ${reason}`)
}

/** Render an install or uninstall outcome; false means the caller exits 1. */
function renderOutcome(
  outcome: MarketInstallOutcome | MarketUninstallOutcome,
  profile: string,
): boolean {
  if (outcome.ok) {
    writeStdout(`done: ${outcome.packageName}${outcome.ok && 'version' in outcome ? `@${outcome.version}` : ''}`)
    // Bundle-layer activation is frozen at host startup; a live reload only
    // refreshes the user's patch files, so the change needs a restart.
    if (outcome.restartRequired) writeStdout(`restart the dsh host for profile ${profile} to activate the change`)
    return true
  }
  writeStderr(outcome.message)
  if (outcome.outputTail !== null) writeStderr(outcome.outputTail)
  return false
}

function renderInstalled(rows: readonly MarketInstalledPlugin[]): void {
  for (const row of rows) {
    const version = row.version ?? 'unresolved'
    const layer = row.isBundleLayer ? ' [bundle layer]' : ''
    const spec = row.spec === null ? '' : ` (${row.spec})`
    const removable = row.removable ? '' : ' [installation-owned]'
    writeStdout(`${row.packageName}  ${version}${spec}${layer}${removable}`)
  }
  if (rows.length === 0) writeStdout('(no plugins installed)')
}

async function runSources(market: LocalMarket): Promise<void> {
  const selected = await market.selectedSource()
  for (const source of await market.listSources()) {
    const marker = source.id === selected ? '*' : ' '
    writeStdout(`${marker} ${source.id}  ${source.name}  (${source.kind})  ${source.url}`)
  }
  if (selected === null) writeStderr('no source is selected — run: dsh market source select <sourceId>')
}

/**
 * Run one `dsh market` invocation.
 * @param profile - the profile the market manages.
 * @param subcommand - the market subcommand chosen on the command line.
 * @param args - the subcommand's arguments.
 * @param sourceAdd - options for `source add`; absent for other subcommands.
 * @returns the process exit code: 0 on success, 1 on failure.
 */
export async function runMarket(
  profile: string,
  subcommand: MarketSubcommand,
  args: readonly string[],
  sourceAdd?: { name: string; kind: string; url: string },
): Promise<number> {
  let market: LocalMarket
  try {
    market = buildMarket(profile)
  } catch (error) {
    writeStderr(error instanceof Error ? error.message : String(error))
    return 1
  }
  try {
    switch (subcommand) {
      case 'search':
        await runSearch(market, args)
        return 0
      case 'view':
        await runView(market, args)
        return 0
      case 'install': {
        const ref = await selectedRef(market, args[0] ?? '')
        if (ref === null) return 1
        return renderOutcome(await market.install(ref), profile) ? 0 : 1
      }
      case 'installed':
        renderInstalled(await market.installed())
        return 0
      case 'uninstall':
        // The id is a package name typed by the user; the service re-validates
        // the grammar and the live manifest before touching the profile.
        return renderOutcome(await market.uninstall((args[0] ?? '') as MarketBundleId), profile) ? 0 : 1
      case 'sources':
        await runSources(market)
        return 0
      case 'source-add': {
        if (sourceAdd === undefined) throw new Error('source add requires --name, --kind, and --url')
        // addSource re-validates the kind against the closed union.
        const source = await market.addSource({ ...sourceAdd, kind: sourceAdd.kind as MarketSourceKind })
        writeStdout(`registered source ${source.name} as ${source.id}`)
        writeStdout(`select it with: dsh market source select ${source.id}`)
        return 0
      }
      case 'source-remove':
        await market.removeSource((args[0] ?? '') as MarketSourceId)
        writeStdout(`removed source ${args[0] ?? ''}`)
        return 0
      case 'source-select':
        await market.selectSource((args[0] ?? '') as MarketSourceId)
        writeStdout(`selected source ${args[0] ?? ''}`)
        return 0
    }
  } catch (error) {
    writeStderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}
