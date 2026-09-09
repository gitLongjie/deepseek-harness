/**
 * The knowledge page: the conversation-area view that stands in for the
 * session surface while the page is open — the deployment's base list in the
 * left pane, the selected base's document browser in the right pane (ima's
 * library layout). The left pane owns the base read; the right pane is the
 * document browser. Any Session navigation closes the page (UiKnowledgeService
 * watches the Session list).
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { KnowledgeBaseRow, KnowledgeLibraryProps } from './contract/slots.ts'
import { KnowledgeBrowser } from './KnowledgeBrowser.tsx'
import css from './KnowledgeLibrary.module.css'

/**
 * Render the knowledge page.
 * @param props - composed slot props (owner share + page-state hook + injected actions).
 * @returns the page element tree.
 */
export function KnowledgeLibrary({
  useView,
  load,
  listDocuments,
  startSession,
  closeBase,
  openBase,
  t,
}: KnowledgeLibraryProps) {
  const browsed = useView(s => s.base)

  // undefined = the base read is in flight; error switches the list for a
  // retry row until a read succeeds.
  const [bases, setBases] = useState<readonly KnowledgeBaseRow[] | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [webUiUrl, setWebUiUrl] = useState<string | null>(null)

  useEffect(() => {
    const reader = new AbortController()
    load()
      .then((result) => {
        if (reader.signal.aborted) return
        setBases(result.bases)
        setWebUiUrl(result.webUiUrl)
        setLoadError(false)
      })
      .catch(() => {
        if (reader.signal.aborted) return
        setLoadError(true)
      })
    return () => { reader.abort() }
  }, [load, reloadToken])

  const retry = () => {
    setLoadError(false)
    setReloadToken(token => token + 1)
  }

  const visible = bases ?? []
  return (
    <div className={css.root}>
      <div className={css.listPane}>
        <div className={css.listHeader}>
          <span className={css.listTitle}>{t('section.knowledge')}</span>
          {webUiUrl !== null && (
            <a className={css.manageLink} href={webUiUrl} target="_blank" rel="noreferrer">
              {t('manage')}
            </a>
          )}
        </div>
        <div className={css.listBody}>
          {loadError && (
            <div className={css.statusRow}>
              <span>{t('error.message')}</span>
              <button type="button" className={css.retryButton} onClick={() => { retry() }}>
                {t('error.retry')}
              </button>
            </div>
          )}
          {!loadError && bases === undefined && <div className={css.statusRow}>{t('loading')}</div>}
          {!loadError && bases !== undefined && visible.length === 0 && (
            <div className={css.statusRow}>{t('empty.none')}</div>
          )}
          {visible.map(base => (
            <button
              type="button"
              key={base.id}
              className={clsx(css.baseRow, browsed?.id === base.id && css.baseRowActive)}
              aria-label={t('row.aria', { name: base.name })}
              title={base.description}
              onClick={() => { openBase(base) }}
            >
              <span className={css.baseName}>{base.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={css.browserPane}>
        {browsed !== undefined ? (
          <KnowledgeBrowser
            base={browsed}
            listDocuments={listDocuments}
            onAsk={() => { startSession() }}
            onClose={() => { closeBase() }}
            t={t}
          />
        ) : (
          <div className={css.placeholder}>{t('page.pickBase')}</div>
        )}
      </div>
    </div>
  )
}
