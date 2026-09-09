/**
 * `knowledge` namespace dictionaries: the sidebar knowledge-base section
 * (section header, search, base rows, states). Runtime failure messages
 * (wire error strings) pass through untranslated by policy.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.knowledge': '知识库',
  'search.aria': '搜索知识库',
  'search.clear': '清除搜索',
  'manage': '管理知识库',
  'row.aria': '浏览“{name}”的文档',
  'browser.back': '返回',
  'browser.ask': '提问',
  'browser.search.placeholder': '搜索文档…',
  'column.name': '名称',
  'column.type': '类型',
  'column.updated': '更新时间',
  'type.url': '网页',
  'type.manual': '手动',
  'date.short': '{m}/{d}',
  'page.pickBase': '选择左侧知识库查看文档',
  'empty.documents': '暂无文档',
  'loading': '正在加载知识库…',
  'error.message': '知识库暂时无法访问',
  'error.retry': '重试',
  'empty.none': '暂无知识库',
  'empty.noMatches': '无匹配知识库',
} satisfies Record<string, string>

/** The knowledge namespace key union. */
export type KnowledgeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.knowledge': 'Knowledge Base',
  'search.aria': 'Search knowledge bases',
  'search.clear': 'Clear search',
  'manage': 'Manage knowledge bases',
  'row.aria': 'Browse documents in {name}',
  'browser.back': 'Back',
  'browser.ask': 'Ask',
  'browser.search.placeholder': 'Search documents...',
  'column.name': 'Name',
  'column.type': 'Type',
  'column.updated': 'Updated',
  'type.url': 'Web page',
  'type.manual': 'Manual',
  'date.short': '{m}/{d}',
  'page.pickBase': 'Pick a knowledge base on the left to browse its documents',
  'empty.documents': 'No documents yet',
  'loading': 'Loading knowledge bases…',
  'error.message': 'Knowledge base is unreachable',
  'error.retry': 'Retry',
  'empty.none': 'No knowledge bases yet',
  'empty.noMatches': 'No matching knowledge bases',
} satisfies Record<KnowledgeKey, string>
