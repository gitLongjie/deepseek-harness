/**
 * The business-entry catalog: the deployment's own task entries in the order
 * the sidebar group renders them. One physical list — the component maps it,
 * the selection id type derives from it, and the instruction a click sends
 * lives here too — so a row's id, its label, and its prompt cannot drift
 * apart.
 */

/** The business entries, top to bottom. */
export const BUSINESS_ENTRIES = [
  { id: 'dailyReport', label: 'item.dailyReport', prompt: 'prompt.dailyReport', dot: '#4338ca' },
  { id: 'topics', label: 'item.topics', prompt: 'prompt.topics', dot: '#3b82f6' },
  { id: 'sentiment', label: 'item.sentiment', prompt: 'prompt.sentiment', dot: '#22c55e' },
  { id: 'videoScript', label: 'item.videoScript', prompt: 'prompt.videoScript', dot: '#f59e0b' },
  { id: 'report', label: 'item.report', prompt: 'prompt.report', dot: '#ef4444' },
  { id: 'multiFormat', label: 'item.multiFormat', prompt: 'prompt.multiFormat', dot: '#8b5cf6' },
  { id: 'rumor', label: 'item.rumor', prompt: 'prompt.rumor', dot: '#14b8a6' },
]
