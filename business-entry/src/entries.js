/**
 * The business-entry catalog: the deployment's own task entries in the order
 * the sidebar group renders them. One physical list — the component maps it
 * and the selection id type derives from it — so a row's id and its label
 * cannot drift apart.
 */

/** The business entries, top to bottom. */
export const BUSINESS_ENTRIES = [
  { id: 'dailyReport', label: 'item.dailyReport', dot: '#4338ca' },
  { id: 'topics', label: 'item.topics', dot: '#3b82f6' },
  { id: 'sentiment', label: 'item.sentiment', dot: '#22c55e' },
  { id: 'videoScript', label: 'item.videoScript', dot: '#f59e0b' },
  { id: 'report', label: 'item.report', dot: '#ef4444' },
  { id: 'multiFormat', label: 'item.multiFormat', dot: '#8b5cf6' },
  { id: 'rumor', label: 'item.rumor', dot: '#14b8a6' },
]
