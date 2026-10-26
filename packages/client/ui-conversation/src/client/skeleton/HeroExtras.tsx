// NEW SESSION hero extras: the skill-pill row above the composer card and the
// starter-suggestion list below it. Both are pure presentation: a pick hands
// the composed prompt text to the owner, which routes it into the input
// machine's draft.

import { useState } from 'react'
import {
  IconRefreshOutline14, IconSkillOutline16, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSlotProps } from '../contract/slots.ts'
import css from './HeroExtras.module.css'

/** The owner's locale seat type, passed down as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/** Starter suggestions in rotation order; three show per page. */
const SUGGESTION_KEYS = [
  'hero.suggestion.0',
  'hero.suggestion.1',
  'hero.suggestion.2',
  'hero.suggestion.3',
  'hero.suggestion.4',
  'hero.suggestion.5',
] as const satisfies readonly `hero.suggestion.${number}`[]

/** Suggestions visible at once. */
const SUGGESTIONS_PER_PAGE = 3

/** Hero extras props shared by the pill row and the suggestion list. */
export interface HeroExtrasProps {
  /** The owner's locale seat. */
  t: HeroTranslate
  /** Fill the composer draft with the picked prompt text. */
  onPick: (text: string) => void
}

/**
 * The skill-pill row above the composer card: one pill per starter skill;
 * picking one fills the draft with the skill's prompt template.
 * @param props - see {@link HeroExtrasProps}.
 * @returns the skill-pill row element.
 */
export function HeroSkillBar({ t, onPick }: HeroExtrasProps) {
  const skills = [
    { key: 'hero.skill.ppt.prompt', label: 'hero.skill.ppt' },
    { key: 'hero.skill.doc.prompt', label: 'hero.skill.doc' },
    { key: 'hero.skill.workbench.prompt', label: 'hero.skill.workbench' },
    { key: 'hero.skill.research.prompt', label: 'hero.skill.research' },
    { key: 'hero.skill.viz.prompt', label: 'hero.skill.viz' },
    { key: 'hero.skill.website.prompt', label: 'hero.skill.website' },
    { key: 'hero.skill.imageGen.prompt', label: 'hero.skill.imageGen' },
    { key: 'hero.skill.videoGen.prompt', label: 'hero.skill.videoGen' },
  ] as const
  return (
    <div className={css.skills}>
      {skills.map(skill => (
        <button
          key={skill.label}
          type="button"
          className={css.skill}
          onClick={() => { onPick(t(skill.key)) }}
        >
          <IconSkillOutline16 className={css.skillIcon} size={14} />
          {t(skill.label)}
        </button>
      ))}
    </div>
  )
}

/**
 * The starter-suggestion list below the composer card: one page of
 * suggestions plus the refresh control that cycles to the next page
 * (wrapping back to the first).
 * @param props - see {@link HeroExtrasProps}.
 * @returns the suggestion list element.
 */
export function HeroSuggestions({ t, onPick }: HeroExtrasProps) {
  const pageCount = Math.ceil(SUGGESTION_KEYS.length / SUGGESTIONS_PER_PAGE)
  const [page, setPage] = useState(0)
  const start = (page % pageCount) * SUGGESTIONS_PER_PAGE
  const visible = SUGGESTION_KEYS.slice(start, start + SUGGESTIONS_PER_PAGE)
  return (
    <div className={css.suggestions}>
      {visible.map(key => (
        <button
          key={key}
          type="button"
          className={css.suggestion}
          onClick={() => { onPick(t(key)) }}
        >
          <IconSparkle16 className={css.suggestionIcon} size={14} />
          <span>{t(key)}</span>
        </button>
      ))}
      <button
        type="button"
        className={css.refresh}
        onClick={() => { setPage(current => current + 1) }}
      >
        <IconRefreshOutline14 className={css.refreshIcon} size={12} />
        {t('hero.suggestions.refresh')}
      </button>
    </div>
  )
}
