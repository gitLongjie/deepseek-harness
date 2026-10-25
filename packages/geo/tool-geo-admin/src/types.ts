/**
 * Wire types shared by the `geo-admin` settings entry and the publishing tools.
 * Types only; HTTP request building lives in `http.ts`.
 * @module @deepseek-ai/dsh-tool-geo-admin/types
 */

/** One website the signed-in publishing account may target. */
export interface GeoWebsite {
  /** Backend id; the `website_id` every article carries. */
  id: number
  /** Display name users match a site by. */
  name: string
  /** Stable site code, when the backend returns one. */
  code?: string
  /** Public domain, when the backend returns one. */
  domain?: string
  /** The account's role on this site (`editor`, …), when returned. */
  role?: string
}

/** Article fields the backend's create endpoint accepts. */
export interface GeoArticleDraft {
  /** Target site; resolved from a name or domain before publishing. */
  website_id: number
  /** Article title; required by the backend. */
  title: string
  /** Plain-text summary; the backend strips HTML from it. */
  summary: string
  /** Markdown body; the backend converts it to HTML. */
  content: string
  /** Comma-separated tags. */
  tags?: string
  /** Category id, when the target site uses one. */
  category_id?: number
  /** Cover image URL. */
  image?: string
  /** Byline. */
  author?: string
  /** Source attribution. */
  source?: string
  /** Source URL. */
  source_url?: string
  /**
   * Whether the article goes live on creation. Omitted means the draft state;
   * the backend default is `false` and the tool keeps that default explicit.
   */
  is_published?: boolean
}

/** The article record returned by create and read-back. */
export interface GeoArticle {
  /** Backend id. */
  id: number
  /** URL slug the backend generated (and de-duplicated) from the title. */
  slug?: string
  /** Title as stored. */
  title: string
  /** Target site. */
  website_id: number
  /** Whether the article is live. */
  is_published: boolean
}

/** One page of a paginated backend list. */
export interface GeoPage<T> {
  /** The rows on this page. */
  items: T[]
  /** Total rows matching the query. */
  total: number
  /** Page number, 1-based. */
  page: number
  /** Page size the backend used. */
  limit: number
  /** Total number of pages. */
  pages: number
}

/** One article row as the list endpoint projects it. */
export interface GeoNewsSummary {
  /** Article id. */
  id: number
  /** Title as stored. */
  title: string
  /** Target site. */
  website_id: number
  /** Whether the article is live. */
  is_published: boolean
  /** URL slug. */
  slug?: string
  /** Category id, when assigned. */
  category_id?: number
  /** Creation timestamp as the backend formats it. */
  created_at?: string
  /** Last-update timestamp as the backend formats it. */
  updated_at?: string
}

/** Filters one article-list query accepts. */
export interface GeoNewsQuery {
  /** Restrict to one site. */
  website_id?: number
  /** Restrict to one category. */
  category_id?: number
  /** Case-insensitive match over title, summary, and content. */
  search?: string
  /** Restrict to live or draft articles. */
  is_published?: boolean
  /** Page number, 1-based. */
  page?: number
  /** Page size. */
  limit?: number
}

/** The fields an article update may change; every field is optional. */
export interface GeoArticlePatch {
  /** New title. */
  title?: string
  /** New plain-text summary. */
  summary?: string
  /** New markdown body. */
  content?: string
  /** Replacement tag list, comma-separated. */
  tags?: string
  /** New category id. */
  category_id?: number
  /** New cover image URL. */
  image?: string
  /** New byline. */
  author?: string
  /** New source attribution. */
  source?: string
  /** New source URL. */
  source_url?: string
  /** Live/draft state. */
  is_published?: boolean
}

/** One content category. */
export interface GeoCategory {
  /** Category id. */
  id: number
  /** Display name. */
  name: string
  /** Site the category belongs to, when scoped. */
  website_id?: number
  /** URL slug. */
  slug?: string
  /** Category kind as the backend classifies it. */
  type?: string
  /** Parent category id, when nested. */
  parent_id?: number
  /** Whether the category is active. */
  is_active?: boolean
}

/** Filters one GEO-task query accepts. */
export interface GeoTaskQuery {
  /** Restrict to one site. */
  website_id?: number
  /** Restrict to one dispatch batch. */
  batch_id?: string
  /** Restrict to one platform (`doubao`, …). */
  platform?: string
  /** Restrict to one task status (`pending`, `running`, `succeeded`, `failed`, …). */
  status?: string
  /** Keyword text to match. */
  q?: string
  /** Page number, 1-based. */
  page?: number
  /** Page size. */
  page_size?: number
}

/** One GEO keyword task as the dispatch list projects it. */
export interface GeoTaskSummary {
  /** Task id. */
  id: string
  /** Keyword the task asks a model. */
  keyword: string
  /** Target model platform. */
  platform: string
  /** Task status. */
  status: string
  /** Target site, when the task belongs to one. */
  website_id?: number
  /** Dispatch batch id, when the task was dispatched in a batch. */
  batch_id?: string
  /** Attempts used so far. */
  attempt_count?: number
  /** Attempt ceiling for the task. */
  max_attempts?: number
  /** Last failure reason, when the task failed. */
  last_error_message?: string
  /** Creation timestamp. */
  created_at?: string
  /** Last-update timestamp. */
  updated_at?: string
}

/** One page of GEO tasks. */
export interface GeoTaskPage {
  /** The rows on this page. */
  items: GeoTaskSummary[]
  /** Total rows matching the query. */
  total: number
  /** Page number, 1-based. */
  page: number
  /** Page size the backend used. */
  page_size: number
}

/** The task a retry request returned. */
export interface GeoTaskRetry {
  /** Task id. */
  id: string
  /** Status after the retry was accepted. */
  status: string
  /** Attempts used so far. */
  attempt_count?: number
  /** Attempt ceiling. */
  max_attempts?: number
  /** Target platform. */
  platform?: string
  /** Keyword. */
  keyword?: string
}

/** Filters one cross-site report query accepts. */
export interface GeoReportQuery {
  /** Restrict to one site. */
  website_id?: number
  /** Site name to match. */
  site_name?: string
  /** Report status (`generating`, `succeeded`, `failed`, …). */
  status?: string
  /** Report source (`manual`, `scheduled`, …). */
  source?: string
  /** Generated-on or after, `YYYY-MM-DD`. */
  start_date?: string
  /** Generated-on or before, `YYYY-MM-DD`. */
  end_date?: string
  /** Page number, 1-based. */
  page?: number
  /** Page size. */
  page_size?: number
}

/** One report row as the cross-site list projects it. */
export interface GeoReportSummary {
  /** Report id. */
  id: string
  /** Site the report covers. */
  website_id: number
  /** Site name. */
  site_name: string
  /** Questions the report analysed. */
  total_qa_count: number
  /** Citations the report counted. */
  total_citation_count: number
  /** Report or generation-job status, when reported. */
  status?: string
  /** Generation timestamp, when generated. */
  generated_at?: string
  /** Submission timestamp. */
  submitted_at?: string
  /** Report source. */
  source?: string
}

/** One page of reports. */
export interface GeoReportPage {
  /** The rows on this page. */
  items: GeoReportSummary[]
  /** Total rows matching the query. */
  total: number
  /** Page number, 1-based. */
  page: number
  /** Page size the backend used. */
  page_size: number
}

/** One brand in a report's ranking. */
export interface GeoReportBrand {
  /** Brand name. */
  name: string
  /** Whether this is the report's own target brand. */
  is_self: boolean
  /** Visibility score, 0–100. */
  visibility_score: number
  /** Mentions counted. */
  mention_count: number
}

/** One stored brand-visibility report, projected to what an operator reads. */
export interface GeoReport {
  /** Report id. */
  id: string
  /** Site the report covers. */
  website_id: number
  /** Site name. */
  site_name: string
  /** Questions the report analysed. */
  total_qa_count: number
  /** Citations the report counted. */
  total_citation_count: number
  /** Mentions accumulated across the site's reports. */
  cumulative_mention_count?: number
  /** Generation timestamp. */
  generated_at?: string
  /** QA window start, `YYYY-MM-DD`. */
  qa_start_date?: string
  /** QA window end, `YYYY-MM-DD`. */
  qa_end_date?: string
  /** The target brand's own visibility score, when the ranking carries it. */
  visibility_score?: number
  /** The leading brands, in ranking order. */
  brands: GeoReportBrand[]
}

/** Request fields for starting one report generation. */
export interface GeoReportRequest {
  /** Site the report covers. */
  website_id: number
  /** QA window start, `YYYY-MM-DD`. */
  qa_start_date?: string
  /** QA window end, `YYYY-MM-DD`. */
  qa_end_date?: string
  /** Report source label; defaults to `manual`. */
  source?: string
  /** Regenerate even when the input signature matches an existing report. */
  force?: boolean
}

/** One report-generation job. */
export interface GeoReportJob {
  /** Job id. */
  id: string
  /** Site the job covers. */
  website_id?: number
  /** Job status. */
  status: string
  /** Report id, once the job produced one. */
  report_id?: string
  /** Failure reason, when the job failed. */
  error_message?: string
  /** Job source. */
  source?: string
  /** Creation timestamp. */
  created_at?: string
  /** Start timestamp. */
  started_at?: string
  /** Finish timestamp. */
  finished_at?: string
}
