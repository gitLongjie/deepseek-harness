/**
 * The sidebar's knowledge entry row: one library-icon row where the workspace
 * section's dropdown used to be. Clicking it opens the knowledge page in the
 * conversation area; the row highlights while the page stands. Conventions
 * mirror the workspace browser's rail and hover chrome.
 */
import clsx from 'clsx'
import { IconLibraryOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KnowledgeNavProps } from './contract/slots.ts'
import css from './KnowledgeNav.module.css'

/**
 * Render the knowledge entry row.
 * @param props - composed slot props (shell owner share + page-state hook + injected action).
 * @returns the nav row element tree.
 */
export function KnowledgeNav({
  wide,
  useView,
  openPage,
  closePage,
  t,
}: KnowledgeNavProps) {
  const open = useView(s => s.open)

  if (!wide) {
    return (
      <div className={css.rail}>
        <button
          type="button"
          className={clsx(css.railButton, open && css.railButtonActive)}
          aria-label={t('section.knowledge')}
          onClick={() => { if (open) { closePage() } else { openPage() } }}
        >
          <IconLibraryOutline16 size={18} />
        </button>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <button
        type="button"
        className={clsx(css.navRow, open && css.navRowActive)}
        aria-label={t('section.knowledge')}
        onClick={() => { if (open) { closePage() } else { openPage() } }}
      >
        <IconLibraryOutline16 size={14} className={css.navIcon} />
        <span className={css.navLabel}>{t('section.knowledge')}</span>
      </button>
    </div>
  )
}
