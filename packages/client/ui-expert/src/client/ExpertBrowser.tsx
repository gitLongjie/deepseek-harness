/**
 * The expert page: the conversation-area view that stands in for the session
 * surface while the page is open — the expert market presented as hireable
 * expert cards, with a search box and the category filter bar the card
 * metadata feeds. Any Session navigation closes the page (UiExpertService
 * watches the Session list); hiring stages the card's preset id for the next
 * session and starts it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExpertBrowserProps, ExpertDetailView, ExpertRecord } from './contract/slots.ts'
import css from './ExpertBrowser.module.css'

/** Human text for a rejected wire call, read by the page's error state. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The version a card shows: the saved one, the plaza one, or both when they differ. */
function versionText(record: ExpertRecord): string | undefined {
  const installed = record.installedVersion ?? record.ownedVersion
  const remote = record.remoteVersion
  if (installed !== undefined && remote !== undefined && installed !== remote) return `${installed} → ${remote}`
  return installed ?? remote
}

/**
 * Whether the published `x.y.z` is higher than the copy saved on this machine.
 * A non-numeric version is not offered as an update.
 */
function versionIsNewer(remote: string | undefined, installed: string | undefined): boolean {
  if (remote === undefined || installed === undefined || remote === installed) return false
  const published = remote.split('.')
  const saved = installed.split('.')
  if (published.length !== 3 || saved.length !== 3) return false
  for (let index = 0; index < 3; index += 1) {
    const left = Number(published[index])
    const right = Number(saved[index])
    if (!Number.isInteger(left) || !Number.isInteger(right)) return false
    if (left !== right) return left > right
  }
  return false
}

/** Shipped category ids whose chip text comes from the expert dictionary. */
const CATEGORY_LABELS: Readonly<Record<string, 'category.general' | 'category.marketing' | 'category.content'>> = {
  general: 'category.general',
  marketing: 'category.marketing',
  content: 'category.content',
}

/**
 * Chip text for one category id.
 * @param id - the category id the roster published.
 * @param translate - expert-dictionary lookup.
 * @returns the localized label for a shipped id, or the id itself when the roster authored another category.
 */
function categoryLabel(id: string, translate: ExpertBrowserProps['t']): string {
  const key = CATEGORY_LABELS[id]
  return key === undefined ? id : translate(key)
}

/** The category ids the roster publishes, in first-seen roster order. */
function categoriesOf(experts: readonly ExpertRecord[]): string[] {
  const seen: string[] = []
  for (const expert of experts) {
    if (expert.category !== undefined && !seen.includes(expert.category)) seen.push(expert.category)
  }
  return seen
}

/** The roster rows the current search text and category filter admit. */
function visibleOf(
  experts: readonly ExpertRecord[],
  search: string,
  category: string | null,
): ExpertRecord[] {
  const needle = search.trim().toLowerCase()
  return experts.filter((expert) => {
    if (category !== null && expert.category !== category) return false
    if (needle === '') return true
    const haystack = [
      expert.name, expert.subtitle ?? '', expert.description ?? '', ...(expert.tags ?? []),
    ].join('\n').toLowerCase()
    return haystack.includes(needle)
  })
}

/** Avatar tile gradients, cycled deterministically by expert id: a row keeps
 * its tone across filtering without the roster carrying presentation data. */
const AVATAR_TONES: readonly string[] = [
  'linear-gradient(135deg, #6a8dff 0%, #7f5bff 100%)',
  'linear-gradient(135deg, #ff9a62 0%, #ff5b8d 100%)',
  'linear-gradient(135deg, #2fd8a8 0%, #18b3c7 100%)',
  'linear-gradient(135deg, #f7b733 0%, #fc4a1a 100%)',
  'linear-gradient(135deg, #5b86e5 0%, #36d1dc 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
]

/** The avatar tile tone for one expert: a stable hash pick from the palette. */
function avatarTone(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? ''
}

/**
 * Render the expert page.
 * @param props - composed slot props (owner share + injected actions + locale seat).
 * @returns the page element tree.
 */
export function ExpertBrowser({
  load,
  loadPlaza,
  hire,
  remove,
  makeDefault,
  publish,
  install,
  detail,
  t,
}: ExpertBrowserProps) {
  // undefined = the market read is in flight; error switches the grid for a
  // retry row until a read succeeds.
  const [experts, setExperts] = useState<readonly ExpertRecord[] | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  // A refused hire or removal. One slot: both are card actions, and the answer
  // belongs to whichever the user just took.
  const [actionError, setActionError] = useState<string | null>(null)
  // The card whose removal is armed. Removing deletes a preset directory, so
  // it takes a second click; arming is per card and any other action clears it.
  const [armedRemove, setArmedRemove] = useState<string | null>(null)
  const [savingDefault, setSavingDefault] = useState<string | null>(null)
  const [section, setSection] = useState<'mine' | 'plaza'>('mine')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailView, setDetailView] = useState<ExpertDetailView | undefined>(undefined)
  const [detailLoading, setDetailLoading] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadedIds, setUploadedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState<{ key: number; text: string; tone?: 'success' } | undefined>(undefined)
  const detailToken = useRef(0)

  useEffect(() => {
    const reader = new AbortController()
    const request = section === 'mine' ? load() : loadPlaza()
    request
      .then((result) => {
        if (reader.signal.aborted) return
        setExperts(result.experts)
        const message = 'message' in result && typeof result.message === 'string' ? result.message : undefined
        setLoadError(result.experts.length === 0 && message !== undefined ? message : null)
      })
      .catch((error: unknown) => {
        if (reader.signal.aborted) return
        setLoadError(messageOf(error))
      })
    return () => { reader.abort() }
  }, [load, loadPlaza, reloadToken, section])

  const categories = useMemo(() => categoriesOf(experts ?? []), [experts])
  const visible = useMemo(
    () => visibleOf(experts ?? [], search, category),
    [experts, search, category],
  )
  // A filter row only earns its place when the metadata actually classifies.
  const showFilters = categories.length > 0

  // Removing the last expert of a category takes its chip with it, which would
  // leave the grid filtered on an id nothing can match and no way back to 全部.
  useEffect(() => {
    if (category !== null && !categories.includes(category)) setCategory(null)
  }, [category, categories])

  /** Open one card's detail and load its persona. */
  const openDetail = (id: string): void => {
    const token = detailToken.current + 1
    detailToken.current = token
    setDetailId(id)
    setDetailView(undefined)
    setDetailLoading(true)
    void detail(id).then(
      (view) => {
        if (detailToken.current !== token) return
        setDetailView(view)
        setDetailLoading(false)
      },
      (error: unknown) => {
        if (detailToken.current !== token) return
        setDetailView({ message: messageOf(error) })
        setDetailLoading(false)
      },
    )
  }

  /** Close the detail dialog and drop a read that is still in flight. */
  const closeDetail = (): void => {
    detailToken.current += 1
    setDetailId(null)
    setDetailLoading(false)
  }

  /** Tell the person the upload finished, or why it stopped. */
  const showNotice = (text: string, tone?: 'success'): void => {
    setNotice(current => ({ key: (current?.key ?? 0) + 1, text, ...(tone === undefined ? {} : { tone }) }))
  }

  /**
   * Upload one card. The button changes immediately; the banner reports the outcome.
   * A finished upload stays marked on that card so a silent list reload is not the only signal.
   */
  const uploadCard = (id: string): void => {
    if (uploadingId !== null) return
    setArmedRemove(null)
    setActionError(null)
    setUploadingId(id)
    void publish(id).then(
      (refused) => {
        setUploadingId(current => (current === id ? null : current))
        if (refused === undefined) {
          setUploadedIds(current => new Set(current).add(id))
          showNotice(t('card.uploaded'), 'success')
          setReloadToken(token => token + 1)
          return
        }
        const message = refused === '' ? t('card.uploadFailed') : refused
        showNotice(message)
        setActionError(message)
      },
      (error: unknown) => {
        setUploadingId(current => (current === id ? null : current))
        const message = messageOf(error)
        showNotice(message === '' ? t('card.uploadFailed') : message)
        setActionError(message === '' ? t('card.uploadFailed') : message)
      },
    )
  }

  /** Upload, download, or update one module, then re-read the open section. */
  const runModule = (action: () => Promise<string | undefined>): void => {
    setArmedRemove(null)
    setActionError(null)
    void action().then(
      (refused) => {
        if (refused === undefined) {
          setReloadToken(token => token + 1)
          return
        }
        setActionError(refused)
      },
      (error: unknown) => { setActionError(messageOf(error)) },
    )
  }

  /** Save one expert as the new-task default, then re-read so the badge moves. */
  const confirmDefault = (id: string): void => {
    setArmedRemove(null)
    setActionError(null)
    setSavingDefault(id)
    void makeDefault(id).then(
      (refused) => {
        setSavingDefault(null)
        if (refused === undefined) {
          setReloadToken(token => token + 1)
          return
        }
        setActionError(refused)
      },
      (error: unknown) => {
        setSavingDefault(null)
        setActionError(messageOf(error))
      },
    )
  }

  /** Remove one armed card, then re-read the market so the grid matches disk. */
  const confirmRemove = (id: string): void => {
    setArmedRemove(null)
    setActionError(null)
    void remove(id).then(
      (refused) => {
        if (refused === undefined) {
          setReloadToken(token => token + 1)
          return
        }
        setActionError(refused)
      },
      (error: unknown) => { setActionError(messageOf(error)) },
    )
  }

  return (
    <div className={css.root}>
      <header className={css.head}>
        <h2 className={css.title}>{t('page.title')}</h2>
        <nav className={css.filters} aria-label={t('page.title')}>
          <button
            type="button"
            className={section === 'mine' ? clsx(css.chip, css.chipActive) : css.chip}
            onClick={() => { closeDetail(); setSection('mine') }}
          >
            {t('module.mine')}
          </button>
          <button
            type="button"
            className={section === 'plaza' ? clsx(css.chip, css.chipActive) : css.chip}
            onClick={() => { closeDetail(); setSection('plaza') }}
          >
            {t('module.plaza')}
          </button>
        </nav>
        <input
          type="search"
          className={css.search}
          aria-label={t('search.aria')}
          placeholder={t('search.placeholder')}
          value={search}
          onChange={(event) => { setSearch(event.target.value) }}
        />
      </header>

      <div className={css.body}>
        {loadError !== null ? (
          <div className={css.state} role="alert">
            <p className={css.stateText}>{loadError}</p>
            <button type="button" className={css.retry} onClick={() => { setReloadToken(token => token + 1) }}>
              {t('error.retry')}
            </button>
          </div>
        ) : experts === undefined ? (
          <div className={css.state}><p className={css.stateText}>{t('loading')}</p></div>
        ) : experts.length === 0 ? (
          <div className={css.state}><p className={css.stateText}>{section === 'plaza' ? t('empty.plaza') : t('empty.none')}</p></div>
        ) : (
          <>
            {actionError !== null && (
              <p className={css.actionError} role="alert">{actionError}</p>
            )}

            {showFilters && (
              <nav className={css.filters} aria-label={t('page.title')}>
                <button
                  type="button"
                  className={category === null ? clsx(css.chip, css.chipActive) : css.chip}
                  onClick={() => { setCategory(null) }}
                >
                  {t('filter.all')}
                </button>
                {categories.map(id => (
                  <button
                    key={id}
                    type="button"
                    className={category === id ? clsx(css.chip, css.chipActive) : css.chip}
                    onClick={() => { setCategory(category === id ? null : id) }}
                  >
                    {categoryLabel(id, t)}
                  </button>
                ))}
              </nav>
            )}

            {visible.length === 0 ? (
              <div className={css.state}><p className={css.stateText}>{t('empty.noMatches')}</p></div>
            ) : (
              <ul className={css.grid}>
                {visible.map(record => (
                  <li key={record.id} className={css.card}>
                    <header className={css.cardHead}>
                      <span className={css.avatar} style={{ background: avatarTone(record.id) }} aria-hidden="true">
                        {record.avatar !== undefined
                          ? <img className={css.avatarImage} src={record.avatar} alt="" loading="lazy" />
                          : record.icon ?? record.name.charAt(0)}
                      </span>
                      <div className={css.cardTitles}>
                        <h3 className={css.cardName}>
                          <span className={css.cardNameText}>{record.name}</span>
                          {record.isDefault === true && <span className={css.defaultMark}>{t('card.default')}</span>}
                          {record.badge !== undefined && <span className={css.cardBadge}>{record.badge}</span>}
                        </h3>
                        {record.subtitle !== undefined && (
                          <p className={css.cardSubtitle}>{record.subtitle}</p>
                        )}
                      </div>
                    </header>
                    {versionText(record) !== undefined && (
                      <p className={css.cardVersion}>{t('detail.version')} {versionText(record)}</p>
                    )}
                    {record.description !== undefined && (
                      <p className={css.cardDescription}>{record.description}</p>
                    )}
                    {(record.tags?.length ?? 0) > 0 && (
                      <ul className={css.tags}>
                        {record.tags?.map(tag => <li key={tag} className={css.tag}>{tag}</li>)}
                      </ul>
                    )}
                    {(record.quickPrompts?.length ?? 0) > 0 && (
                      <ul className={css.prompts} aria-label={t('quickPrompts.label')}>
                        {record.quickPrompts?.map(prompt => (
                          <li key={prompt} className={css.prompt}>{prompt}</li>
                        ))}
                      </ul>
                    )}
                    {record.broken !== undefined && (
                      <p className={css.broken} role="note">{t('card.broken', { reason: record.broken })}</p>
                    )}
                    <div className={css.cardActions}>
                      <button
                        type="button"
                        className={css.remove}
                        onClick={() => { openDetail(record.id) }}
                      >
                        {t('card.details')}
                      </button>
                      {section === 'mine' && record.canUpload === true && (
                        <button
                          type="button"
                          className={css.remove}
                          disabled={uploadingId !== null || uploadedIds.has(record.id)}
                          aria-busy={uploadingId === record.id}
                          onClick={() => { uploadCard(record.id) }}
                        >
                          {uploadingId === record.id
                            ? t('card.uploading')
                            : uploadedIds.has(record.id) ? t('card.uploaded') : t('card.upload')}
                        </button>
                      )}
                      {section === 'plaza' && record.installedVersion === undefined && record.ownedVersion === undefined && (
                        <button
                          type="button"
                          className={css.hire}
                          onClick={() => { runModule(() => install(record.id)) }}
                        >
                          {t('card.download')}
                        </button>
                      )}
                      {section === 'plaza' && record.installedVersion !== undefined && versionIsNewer(record.remoteVersion, record.installedVersion) && (
                        <button
                          type="button"
                          className={css.hire}
                          onClick={() => { runModule(() => install(record.id)) }}
                        >
                          {t('card.update')}
                        </button>
                      )}
                      {section === 'plaza' && (record.installedVersion ?? record.ownedVersion) !== undefined && (record.installedVersion ?? record.ownedVersion) === record.remoteVersion && (
                        <span className={css.defaultMark}>{t('card.latest')}</span>
                      )}
                      {section === 'mine' && versionIsNewer(record.remoteVersion, record.installedVersion) && (
                        <button
                          type="button"
                          className={css.hire}
                          onClick={() => { runModule(() => install(record.id)) }}
                        >
                          {t('card.update')}
                        </button>
                      )}
                      {section === 'mine' && record.isDefault !== true && record.broken === undefined && (
                        <button
                          type="button"
                          className={css.makeDefault}
                          disabled={savingDefault !== null}
                          aria-label={`${t('card.setDefault')}: ${record.name}`}
                          onClick={() => { confirmDefault(record.id) }}
                        >
                          {t('card.setDefault')}
                        </button>
                      )}
                      {(section === 'mine' || record.installedVersion !== undefined) && <button
                        type="button"
                        className={css.hire}
                        disabled={record.broken !== undefined}
                        onClick={() => {
                          setArmedRemove(null)
                          setActionError(null)
                          // A refusal means nothing will compose the chat this
                          // hire promises; the page stays and says so.
                          const refused = hire(record.id)
                          if (refused !== undefined) setActionError(refused)
                        }}
                      >
                        {t('card.hire')}
                      </button>}
                      {/* Only the person's own expert is theirs to remove: a
                          shipped one belongs to the deployment, and the
                          settings section cannot offer the rest because it
                          excludes expert-marked rows. */}
                      {section === 'mine' && record.trust === 'user' && (armedRemove === record.id ? (
                        <>
                          <button
                            type="button"
                            className={css.removeConfirm}
                            onClick={() => { confirmRemove(record.id) }}
                          >
                            {t('card.removeConfirm')}
                          </button>
                          <button
                            type="button"
                            className={css.cancel}
                            onClick={() => { setArmedRemove(null) }}
                          >
                            {t('card.cancel')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={css.remove}
                          onClick={() => {
                            setActionError(null)
                            setArmedRemove(record.id)
                          }}
                        >
                          {t('card.remove')}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <ExpertDetail
        record={(experts ?? []).find(expert => expert.id === detailId)}
        view={detailView}
        loading={detailLoading}
        t={t}
        onClose={closeDetail}
      />
      {notice !== undefined && (
        <Toast
          key={notice.key}
          text={notice.text}
          {...(notice.tone === undefined ? {} : { tone: notice.tone })}
          onDone={() => {
            setNotice(current => (current?.key === notice.key ? undefined : current))
          }}
        />
      )}
    </div>
  )
}

/**
 * Detail dialog for one expert card.
 * @param record - the card, absent when the dialog is closed.
 * @param view - persona and skills once the read settles.
 * @param loading - whether that read is still in flight.
 * @param t - expert-dictionary lookup.
 * @param onClose - close command.
 * @returns the dialog, or nothing while no card is selected.
 */
function ExpertDetail({
  record,
  view,
  loading,
  t,
  onClose,
}: {
  record: ExpertRecord | undefined
  view: ExpertDetailView | undefined
  loading: boolean
  t: ExpertBrowserProps['t']
  onClose: () => void
}) {
  const open = record !== undefined
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={record?.name ?? ''}
      closeLabel={t('detail.close')}
      className={css.detailDialog ?? ''}
      contentClassName={css.detailContent ?? ''}
    >
      {record !== undefined && (
        <div className={css.detailBody}>
          {record.subtitle !== undefined && <p className={css.cardSubtitle}>{record.subtitle}</p>}
          {record.description !== undefined && <p className={css.detailText}>{record.description}</p>}
          {record.category !== undefined && (
            <p className={css.detailText}>{t('detail.category')} {categoryLabel(record.category, t)}</p>
          )}
          {(record.installedVersion !== undefined || record.remoteVersion !== undefined) && (
            <p className={css.detailText}>{t('detail.version')} {versionText(record)}</p>
          )}
          {(record.tags?.length ?? 0) > 0 && (
            <ul className={css.tags}>
              {record.tags?.map(tag => <li key={tag} className={css.tag}>{tag}</li>)}
            </ul>
          )}
          {(record.quickPrompts?.length ?? 0) > 0 && (
            <ul className={css.prompts} aria-label={t('quickPrompts.label')}>
              {record.quickPrompts?.map(prompt => <li key={prompt} className={css.detailText}>{prompt}</li>)}
            </ul>
          )}
          {loading && <p className={css.detailText}>{t('detail.loading')}</p>}
          {view?.message !== undefined && <p className={css.detailText} role="alert">{view.message}</p>}
          {view?.persona !== undefined && (
            <>
              <p className={css.detailLabel}>{t('detail.persona')}</p>
              <p className={css.detailText}>{view.persona}</p>
            </>
          )}
          {(view?.skills?.length ?? 0) > 0 && (
            <>
              <p className={css.detailLabel}>{t('detail.skills')}</p>
              <ul className={css.tags}>
                {view?.skills?.map(skill => <li key={skill} className={css.tag}>{skill}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
