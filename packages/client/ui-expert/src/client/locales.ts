/**
 * `expert` namespace dictionaries: the sidebar expert section (entry row) and
 * the expert page (search, filters, cards, hire, states). Runtime failure
 * messages (wire error strings) pass through untranslated by policy.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.experts': '专家',
  'page.title': '专家',
  'search.aria': '搜索专家',
  'search.placeholder': '搜索专家职称或描述…',
  'filter.all': '全部',
  'card.hire': '聘用到新对话',
  'card.broken': '该专家暂时无法聘用：{reason}',
  'quickPrompts.label': '推荐提问',
  'loading': '正在加载专家…',
  'error.message': '专家列表暂时无法访问',
  'error.retry': '重试',
  'empty.none': '市场暂无专家',
  'empty.noMatches': '无匹配专家',
} satisfies Record<string, string>

/** The expert namespace key union. */
export type ExpertKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.experts': 'Experts',
  'page.title': 'Experts',
  'search.aria': 'Search experts',
  'search.placeholder': 'Search experts by title or description…',
  'filter.all': 'All',
  'card.hire': 'Hire in a new chat',
  'card.broken': 'This expert cannot be hired right now: {reason}',
  'quickPrompts.label': 'Suggested prompts',
  'loading': 'Loading experts…',
  'error.message': 'The expert list is temporarily unavailable',
  'error.retry': 'Retry',
  'empty.none': 'No experts in the market yet',
  'empty.noMatches': 'No matching experts',
} satisfies Record<ExpertKey, string>
