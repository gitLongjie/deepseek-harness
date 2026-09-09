/**
 * The document-browser pane of the knowledge page: header (back, base title,
 * inline search) over the document table (名称/类型/更新时间). The pane owns
 * its read state — load, filter, retry — and reports the header's actions back
 * to the page (ask starts a Session, back returns to the base list). Header,
 * search, and state conventions mirror the sidebar rows so the surfaces read
 * as one feature.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14, IconLibraryOutline16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeDocumentRow } from './contract/slots.ts'
import css from './KnowledgeBrowser.module.css'

/** Backend filter debounce for the keyword input. */
const SEARCH_DEBOUNCE_MS = 300

/** Locale seat shape of the pane: knowledge keys with substitution params. */
type PaneTranslate = TranslateNS<'knowledge'>

/** Render the 类型 cell: the extension uppercased, or the entry kind's label. */
function typeLabel(doc: KnowledgeDocumentRow, t: PaneTranslate): string {
  if (doc.kind === 'url') return t('type.url')
  if (doc.kind === 'manual') return t('type.manual')
  return (doc.fileType ?? '').toUpperCase()
}

/** Render the 更新时间 cell as the short month/day stamp. */
function updatedAt(doc: KnowledgeDocumentRow, t: PaneTranslate): string {
  if (doc.updatedAt === undefined) return ''
  const parsed = new Date(doc.updatedAt)
  if (Number.isNaN(parsed.getTime())) return ''
  return t('date.short', { m: String(parsed.getMonth() + 1), d: String(parsed.getDate()) })
}

/** Props of the document-browser pane. */
export interface KnowledgeBrowserProps {
  /** The base whose documents this pane lists. */
  base: { id: string; name: string }
  /**
   * List the base's documents, optionally keyword-filtered by the backend.
   * @param baseId - the base id to read.
   * @param keyword - backend-matched filter; empty means unfiltered.
   */
  listDocuments: (baseId: string, keyword?: string) => Promise<{
    documents: readonly KnowledgeDocumentRow[]
    total: number
  }>
  /** The header's ask action: start a New Session grounded in this base. */
  onAsk: () => void
  /** The header's back action: return to the base list. */
  onClose: () => void
  /** The locale seat. */
  t: PaneTranslate
}

/**
 * Render the document-browser pane.
 * @param props - pane props.
 * @returns the browser element tree.
 */
export function KnowledgeBrowser({
  base,
  listDocuments,
  onAsk,
  onClose,
  t,
}: KnowledgeBrowserProps) {
  // undefined = the read for the current keyword is in flight; error switches
  // the table for a retry row until a read succeeds.
  const [documents, setDocuments] = useState<readonly KnowledgeDocumentRow[] | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const reader = new AbortController()
    const timer = window.setTimeout(() => {
      listDocuments(base.id, query.trim())
        .then((page) => {
          if (reader.signal.aborted) return
          setDocuments(page.documents)
          setLoadError(false)
        })
        .catch(() => {
          if (reader.signal.aborted) return
          setLoadError(true)
        })
    }, query === '' ? 0 : SEARCH_DEBOUNCE_MS)
    return () => {
      reader.abort()
      window.clearTimeout(timer)
    }
  }, [base.id, query, listDocuments, reloadToken])

  const retry = useCallback(() => {
    setLoadError(false)
    setReloadToken(token => token + 1)
  }, [])

  const visible = documents ?? []
  return (
    <div className={css.root}>
      <div className={css.browserHeader}>
        <button
          type="button"
          className={css.backButton}
          aria-label={t('browser.back')}
          onClick={() => { onClose() }}
        >
          <IconChevronLeftOutline14 size={14} />
        </button>
        <span className={css.browserTitle}>{base.name}</span>
        <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
          <div
            className={clsx(css.search, searchExpanded && css.searchExpanded)}
            onClick={() => { setSearchExpanded(true); searchInput.current?.focus() }}
          >
            <button
              type="button"
              className={css.searchButton}
              aria-label={t('search.aria')}
              aria-expanded={searchExpanded}
              onClick={(e) => { e.stopPropagation(); setSearchExpanded(true) }}
            >
              <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
            </button>
            <input
              ref={searchInput}
              className={css.searchInput}
              type="text"
              placeholder={t('browser.search.placeholder')}
              value={query}
              tabIndex={searchExpanded ? 0 : -1}
              onChange={(e) => { setQuery(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                setQuery('')
                setSearchExpanded(false)
              }}
            />
          </div>
        </div>
        <button
          type="button"
          className={css.askButton}
          onClick={() => { onAsk() }}
        >
          {t('browser.ask')}
        </button>
      </div>

      <div className={css.tableHead}>
        <span className={css.columnName}>{t('column.name')}</span>
        <span className={css.columnType}>{t('column.type')}</span>
        <span className={css.columnUpdated}>{t('column.updated')}</span>
      </div>

      <div className={css.tableBody}>
        {loadError && (
          <div className={css.statusRow}>
            <span>{t('error.message')}</span>
            <button type="button" className={css.retryButton} onClick={() => { retry() }}>
              {t('error.retry')}
            </button>
          </div>
        )}
        {!loadError && documents === undefined && <div className={css.statusRow}>{t('loading')}</div>}
        {!loadError && documents !== undefined && visible.length === 0 && (
          <div className={css.statusRow}>{query.trim() === '' ? t('empty.documents') : t('empty.noMatches')}</div>
        )}
        {visible.map(doc => (
          <div key={doc.id} className={css.docRow} title={doc.title}>
            <span className={css.docName}>
              <IconLibraryOutline16 size={14} className={css.docIcon} />
              <span className={css.docTitle}>{doc.title}</span>
            </span>
            <span className={css.docType}>{typeLabel(doc, t)}</span>
            <span className={css.docUpdated}>{updatedAt(doc, t)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
