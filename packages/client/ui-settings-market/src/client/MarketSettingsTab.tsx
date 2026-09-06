/** Marketplace tab registered into Web Plugins settings. */

import { useEffect, useId, useState, type ReactNode } from 'react'
import type {
  MarketCatalogEntry,
  MarketCatalogPage,
  MarketInstallOutcome,
  MarketInstallability,
  MarketInstalledPlugin,
  MarketSource,
  MarketUninstallOutcome,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MarketSettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface MarketSettingsTabInjected {
  /** List the configured sources in registry order. */
  listSources: () => Promise<{ sources: readonly MarketSource[] }>
  /** Read the current source selection. */
  selectedSource: () => Promise<string | null>
  /** Select the source subsequent browsing reads. */
  selectSource: (sourceId: string) => Promise<void>
  /** Read one page from the selected source. */
  browse: (query: { query?: string; limit: number }) => Promise<MarketCatalogPage>
  /** Validate one entry against the npm registry. */
  installability: (ref: { sourceId: string; entryId: string }) => Promise<MarketInstallability>
  /** Validate and install one entry into the managed profile. */
  install: (ref: { sourceId: string; entryId: string }) => Promise<MarketInstallOutcome>
  /** Read the installed-plugin view of the managed profile. */
  installed: () => Promise<{ plugins: readonly MarketInstalledPlugin[] }>
  /** Remove one dependency-managed plugin from the managed profile. */
  uninstall: (bundleId: string) => Promise<MarketUninstallOutcome>
}

/** Full component props assembled by the Settings slot renderer. */
export type MarketSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.market'>
  & InjectFace<MarketSettingsTabInjected>

type ViewName = 'discover' | 'installed' | 'sources'

/** One discover row's expanding detail state. */
interface EntryDetailState {
  readonly entry: MarketCatalogEntry
  readonly installability: MarketInstallability
}

/** Per-view read state: each view loads on activation and reports failure. */
type ReadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: T }

/** One in-flight or settled mutation note shown above the lists. */
interface MutationNote {
  readonly kind: 'success' | 'failure'
  readonly text: string
}

const SEARCH_LIMIT = 50

/** Render the marketplace: discover, installed, and source views. */
export function MarketSettingsTab({
  t, listSources, selectedSource, selectSource, browse, installability, install, installed, uninstall,
}: MarketSettingsTabProps): ReactNode {
  const sectionId = useId()
  const [view, setView] = useState<ViewName>('discover')
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [discover, setDiscover] = useState<ReadState<MarketCatalogPage>>({ status: 'loading' })
  const [installRows, setInstallRows] = useState<ReadState<readonly MarketInstalledPlugin[]>>({ status: 'loading' })
  const [sourceRows, setSourceRows] = useState<ReadState<readonly MarketSource[]>>({ status: 'loading' })
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [detail, setDetail] = useState<EntryDetailState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<MutationNote | null>(null)

  // Discover: the page follows the query and the selected source.
  useEffect(() => {
    if (view !== 'discover') return
    let current = true
    const search = query.trim()
    setDiscover({ status: 'loading' })
    void selectedSource().then((sourceId) => {
      if (!current) return
      setSelected(sourceId)
      if (sourceId === null) {
        setDiscover({ status: 'ready', value: { entries: [], nextCursor: null, total: null } })
        return
      }
      void browse({ ...(search === '' ? {} : { query: search }), limit: SEARCH_LIMIT }).then(
        (result) => { if (current) setDiscover({ status: 'ready', value: result }) },
        () => { if (current) setDiscover({ status: 'error' }) },
      )
    }, () => {
      if (current) setDiscover({ status: 'error' })
    })
    return () => { current = false }
  }, [browse, selectedSource, query, request, view])

  // Installed: one read per activation.
  useEffect(() => {
    if (view !== 'installed') return
    let current = true
    setInstallRows({ status: 'loading' })
    void installed().then(
      (result) => { if (current) setInstallRows({ status: 'ready', value: result.plugins }) },
      () => { if (current) setInstallRows({ status: 'error' }) },
    )
    return () => { current = false }
  }, [installed, request, view])

  // Sources: one read per activation.
  useEffect(() => {
    if (view !== 'sources') return
    let current = true
    setSourceRows({ status: 'loading' })
    void Promise.all([listSources(), selectedSource()]).then(
      ([listed, sourceId]) => {
        if (!current) return
        setSourceRows({ status: 'ready', value: listed.sources })
        setSelected(sourceId)
      },
      () => { if (current) setSourceRows({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listSources, request, selectedSource, view])

  const retry = (): void => {
    setNote(null)
    setBusy(null)
    setRequest(value => value + 1)
  }

  const expandEntry = (entry: MarketCatalogEntry): void => {
    if (openEntry === entry.entryId) {
      setOpenEntry(null)
      return
    }
    setOpenEntry(entry.entryId)
    setDetail(null)
    if (selected === null) return
    void installability({ sourceId: selected, entryId: entry.entryId }).then(
      (result) => { setDetail({ entry, installability: result }) },
      () => { setDetail(null) },
    )
  }

  const renderOutcome = (outcome: MarketInstallOutcome | MarketUninstallOutcome, successText: string): void => {
    if (outcome.ok) {
      setNote({ kind: 'success', text: `${successText} ${t('restartRequired')}` })
      return
    }
    setNote({ kind: 'failure', text: outcome.message })
  }

  /** A rejected mutation carries the service's diagnostic; show it beside the locale copy. */
  const noteFailure = (error: unknown): void => {
    const detail = error instanceof Error && error.message !== '' ? ` ${error.message}` : ''
    setNote({ kind: 'failure', text: `${t('error')}${detail}` })
  }

  const runInstall = (entry: MarketCatalogEntry): void => {
    if (selected === null || busy !== null) return
    setBusy(entry.entryId)
    void install({ sourceId: selected, entryId: entry.entryId }).then(
      (outcome) => {
        setBusy(null)
        renderOutcome(outcome, `${t('installSuccess')} ${outcome.ok ? `${outcome.packageName}@${outcome.version}` : ''}`)
      },
      (error) => {
        setBusy(null)
        noteFailure(error)
      },
    )
  }

  const runUninstall = (row: MarketInstalledPlugin): void => {
    if (busy !== null) return
    setBusy(row.bundleId)
    void uninstall(row.bundleId).then(
      (outcome) => {
        setBusy(null)
        if (outcome.ok) setRequest(value => value + 1)
        renderOutcome(outcome, t('uninstallSuccess'))
      },
      (error) => {
        setBusy(null)
        noteFailure(error)
      },
    )
  }

  const runSelect = (sourceId: string): void => {
    void selectSource(sourceId).then(retry, noteFailure)
  }

  const views: readonly { readonly name: ViewName; readonly label: string }[] = [
    { name: 'discover', label: t('viewDiscover') },
    { name: 'installed', label: t('viewInstalled') },
    { name: 'sources', label: t('viewSources') },
  ]

  return (
    <div className={css.section} aria-busy={busy !== null}>
      <div className={css.viewSwitch}>
        {views.map(entry => (
          <button
            key={entry.name}
            type="button"
            className={css.viewTab}
            aria-pressed={view === entry.name}
            onClick={() => {
              setView(entry.name)
              setNote(null)
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {note !== null ? (
        <p className={css.note} data-note={note.kind}>{note.text}</p>
      ) : null}

      {view === 'discover' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          {discover.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
          {discover.status === 'error' ? (
            <div className={css.failure}>
              <p role="alert">{t('error')}</p>
              <button type="button" onClick={retry}>{t('retry')}</button>
            </div>
          ) : null}
          {discover.status === 'ready' ? (
            <>
              {selected === null ? <p className={css.status}>{t('noSourceSelected')}</p> : null}
              {discover.value.entries.length === 0 && selected !== null ? (
                <p className={css.status}>{query.trim() === '' ? t('empty') : t('emptySearch')}</p>
              ) : null}
              {discover.value.nextCursor !== null ? <p className={css.status}>{t('morePages')}</p> : null}
              {discover.value.entries.length > 0 ? (
                <ul className={css.cards}>
                  {discover.value.entries.map(entry => (
                    <li
                      className={css.card}
                      key={`${entry.sourceId}:${entry.entryId}`}
                      data-market-entry={entry.entryId}
                    >
                      <button
                        className={css.cardContent}
                        type="button"
                        aria-expanded={openEntry === entry.entryId}
                        aria-controls={`${sectionId}-details-${encodeURIComponent(entry.entryId)}`}
                        onClick={() => { expandEntry(entry) }}
                      >
                        <strong className={css.cardTitle}>{entry.name}</strong>
                        <span className={css.cardSummary}>{entry.summary}</span>
                      </button>
                      {openEntry === entry.entryId ? (
                        <div className={css.cardDetails} id={`${sectionId}-details-${encodeURIComponent(entry.entryId)}`}>
                          {entry.npmPackage !== undefined ? <code className={css.entryValue}>{entry.npmPackage}</code> : null}
                          {detail !== null && detail.entry.entryId === entry.entryId ? (
                            <>
                              <p className={css.detailLine}>
                                {detail.installability.installable ? t('installable') : t('notInstallable')}
                                {detail.installability.resolvedVersion !== null
                                  ? ` · ${t('npmLatest')} ${detail.installability.resolvedVersion}`
                                  : ''}
                              </p>
                              {detail.installability.installable ? (
                                <button
                                  type="button"
                                  className={css.action}
                                  disabled={busy !== null}
                                  onClick={() => { runInstall(entry) }}
                                >
                                  {busy === entry.entryId ? t('installing') : t('install')}
                                </button>
                              ) : (
                                <ul className={css.reasons}>
                                  {detail.installability.reasons.map(reason => <li key={reason}>{reason}</li>)}
                                </ul>
                              )}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {view === 'installed' ? (
        <div className={css.catalog}>
          {installRows.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
          {installRows.status === 'error' ? (
            <div className={css.failure}>
              <p role="alert">{t('error')}</p>
              <button type="button" onClick={retry}>{t('retry')}</button>
            </div>
          ) : null}
          {installRows.status === 'ready' ? (
            installRows.value.length === 0
              ? <p className={css.status}>{t('empty')}</p>
              : (
                <ul className={css.cards}>
                  {installRows.value.map(row => (
                    <li className={css.card} key={row.packageName} data-installed-row={row.packageName}>
                      <div className={css.cardContent}>
                        <strong className={css.cardTitle}>{row.packageName}</strong>
                        <span className={css.cardSummary}>
                          {row.version ?? t('unresolved')}
                          {row.isBundleLayer ? ` · ${t('bundleLayer')}` : ''}
                          {!row.removable ? ` · ${t('installationOwned')}` : ''}
                        </span>
                      </div>
                      {row.removable ? (
                        <button
                          type="button"
                          className={css.action}
                          disabled={busy !== null}
                          onClick={() => { runUninstall(row) }}
                        >
                          {busy === row.bundleId ? t('uninstalling') : t('uninstall')}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
          ) : null}
        </div>
      ) : null}

      {view === 'sources' ? (
        <div className={css.catalog}>
          {sourceRows.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
          {sourceRows.status === 'error' ? (
            <div className={css.failure}>
              <p role="alert">{t('error')}</p>
              <button type="button" onClick={retry}>{t('retry')}</button>
            </div>
          ) : null}
          {sourceRows.status === 'ready' ? (
            sourceRows.value.length === 0
              ? <p className={css.status}>{t('empty')}</p>
              : (
                <ul className={css.cards}>
                  {sourceRows.value.map(source => (
                    <li className={css.card} key={source.id} data-source-row={source.id}>
                      <div className={css.cardContent}>
                        <strong className={css.cardTitle}>{source.name}</strong>
                        <span className={css.cardSummary}>{source.url}</span>
                      </div>
                      <div className={css.cardTrailing}>
                        {source.id === selected
                          ? <span className={css.selectedTag}>{t('selected')}</span>
                          : (
                            <button type="button" className={css.action} onClick={() => { runSelect(source.id) }}>
                              {t('select')}
                            </button>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
              )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
