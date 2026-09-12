/**
 * The sidebar's expert entry row: one expert-icon row between the knowledge
 * and business-entry sections. Clicking it opens the expert page in the
 * conversation area; the row highlights while the page stands. Conventions
 * mirror the knowledge entry row's rail and hover chrome.
 */
import clsx from 'clsx'
import { IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExpertNavProps } from './contract/slots.ts'
import css from './ExpertNav.module.css'

/**
 * Render the expert entry row.
 * @param props - composed slot props (shell owner share + page-state hook + injected action).
 * @returns the nav row element tree.
 */
export function ExpertNav({
  wide,
  useView,
  openPage,
  closePage,
  t,
}: ExpertNavProps) {
  const open = useView(s => s.open)

  if (!wide) {
    return (
      <div className={css.rail}>
        <button
          type="button"
          className={clsx(css.railButton, open && css.railButtonActive)}
          aria-label={t('section.experts')}
          onClick={() => { if (open) { closePage() } else { openPage() } }}
        >
          <IconSparkle16 size={18} />
        </button>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <button
        type="button"
        className={clsx(css.navRow, open && css.navRowActive)}
        aria-label={t('section.experts')}
        onClick={() => { if (open) { closePage() } else { openPage() } }}
      >
        <IconSparkle16 size={14} className={css.navIcon} />
        <span className={css.navLabel}>{t('section.experts')}</span>
      </button>
    </div>
  )
}
