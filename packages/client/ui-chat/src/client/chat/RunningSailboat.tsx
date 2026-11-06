/** Animated sailboat mask and static SVG fallback for the running Chat status. */
import css from './ChatView.module.css'

const REST_PATH = 'M2.35 10.05Q7.7 9.72 13.7 9.58M2.35 10.05C4.15 14.72 11.7 14.55 13.7 9.58M6.45 9.86L6.45 1.72M6.45 2.28Q10.064 4.892 12.35 8.72L6.45 9.28'

/**
 * Render the decorative running icon; the APNG asset owns its animation timing.
 * @returns mask and static SVG selected by browser capabilities and accessibility preferences.
 */
export function RunningSailboat() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <span className={css.runningSailAnimated} />
      <svg className={css.runningSailStill} width="100%" height="100%" viewBox="0 0 16 16" fill="none">
        <path d={REST_PATH} stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
