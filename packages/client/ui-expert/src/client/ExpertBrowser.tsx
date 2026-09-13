/**
 * The expert page: the conversation-area view that stands in for the session
 * surface while the page is open — the expert market presented as hireable
 * expert cards, with a search box and the category filter bar the card
 * metadata feeds. Any Session navigation closes the page (UiExpertService
 * watches the Session list); hiring stages the card's preset id for the next
 * session and starts it.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { ExpertBrowserProps, ExpertRecord } from './contract/slots.ts'
import { MOCK_FEATURED_SCENARIOS } from './mock-data.ts'
import css from './ExpertBrowser.module.css'

/** Human text for a rejected wire call, read by the page's error state. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** Whether to show the featured-scenario banners (only when no search/filter is active). */
function showFeatured(search: string, category: string | null): boolean {
  return search.trim() === '' && category === null
}

/**
 * Render the expert page.
 * @param props - composed slot props (owner share + injected actions + locale seat).
 * @returns the page element tree.
 */
export function ExpertBrowser({
  load,
  hire,
  t,
}: ExpertBrowserProps) {
  // undefined = the market read is in flight; error switches the grid for a
  // retry row until a read succeeds.
  const [experts, setExperts] = useState<readonly ExpertRecord[] | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  useEffect(() => {
    const reader = new AbortController()
    load()
      .then((result) => {
        if (reader.signal.aborted) return
        setExperts(result.experts)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (reader.signal.aborted) return
        setLoadError(messageOf(error))
      })
    return () => { reader.abort() }
  }, [load, reloadToken])

  const categories = useMemo(() => categoriesOf(experts ?? []), [experts])
  const visible = useMemo(
    () => visibleOf(experts ?? [], search, category),
    [experts, search, category],
  )
  // A filter row only earns its place when the metadata actually classifies.
  const showFilters = categories.length > 0
  const featured = showFeatured(search, category)

  return (
    <div className={css.root}>
      <header className={css.head}>
        <h2 className={css.title}>{t('page.title')}</h2>
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
          <div className={css.state}><p className={css.stateText}>{t('empty.none')}</p></div>
        ) : (
          <>
            {/* Featured scenario banners — shown only when no search/filter is active. */}
            {featured && (
              <section className={css.featuredSection}>
                <h3 className={css.sectionTitle}>{t('featured.title')}</h3>
                <div className={css.featuredGrid}>
                  {MOCK_FEATURED_SCENARIOS.map(scenario => (
                    <div key={scenario.id} className={css.featuredCard} style={{ background: scenario.gradient }}>
                      <h4 className={css.featuredTitle}>{scenario.title}</h4>
                      <ul className={css.featuredExperts}>
                        {scenario.experts.map(expert => (
                          <li key={expert.name} className={css.featuredExpert}>
                            <span className={css.featuredExpertIcon} aria-hidden="true">{expert.icon}</span>
                            <span className={css.featuredExpertName}>{expert.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
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
                    {id}
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
                          {record.badge !== undefined && <span className={css.cardBadge}>{record.badge}</span>}
                        </h3>
                        {record.subtitle !== undefined && (
                          <p className={css.cardSubtitle}>{record.subtitle}</p>
                        )}
                      </div>
                    </header>
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
                    <button type="button" className={css.hire} onClick={() => { hire(record.id) }}>
                      {t('card.hire')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
