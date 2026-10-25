/**
 * Model-facing 深度云海 tools over the GEO multi-site content backend: list the
 * sites the configured account may publish to, list and read articles, list
 * categories, create an article and read it back, and change an existing
 * article. The backend address and account come from the host `geo-admin`
 * settings namespace; the password comes from the credentials store under
 * {@link GEO_ADMIN_PASSWORD_REF} and is resolved per call, so neither a
 * settings document nor a tool result carries the literal.
 *
 * The tools are preset-mounted: each registers into the calling agent's `tools`
 * registry, so a session that does not hire the expert never sees them.
 * @module @deepseek-ai/dsh-tool-geo-admin
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { GeoAdminError } from './errors.ts'
import {
  deleteArticle, fetchArticle, generateReport, getReport, getReportJob, listCategories, listNews, listReports,
  listTasks, listWebsites, publishArticle, retryTask, updateArticle,
} from './http.ts'
import type { GeoAdminTarget } from './http.ts'
import { GEO_ADMIN_PASSWORD_REF } from './settings.ts'
import type {
  GeoArticle, GeoArticleDraft, GeoArticlePatch, GeoCategory, GeoNewsQuery, GeoNewsSummary, GeoPage, GeoReport,
  GeoReportJob, GeoReportPage, GeoReportQuery, GeoReportRequest, GeoTaskPage, GeoTaskQuery, GeoTaskRetry,
  GeoWebsite,
} from './types.ts'

export { GeoAdminError } from './errors.ts'
export type { GeoAdminErrorCode } from './errors.ts'
export { GEO_ADMIN_PASSWORD_REF, GEO_ADMIN_SETTINGS_NAMESPACE } from './settings.ts'
export type { GeoAdminSettingsSection, GeoAdminSettingsView } from './settings.ts'
export type {
  GeoArticle, GeoArticleDraft, GeoArticlePatch, GeoCategory, GeoNewsQuery, GeoNewsSummary, GeoPage, GeoReport,
  GeoReportBrand, GeoReportJob, GeoReportPage, GeoReportQuery, GeoReportRequest, GeoReportSummary, GeoTaskPage,
  GeoTaskQuery, GeoTaskRetry, GeoTaskSummary, GeoWebsite,
} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-geo-admin'

/** Services the publishing tools require. */
export const inject = ['tools', 'credentials'] as const

/** Plugin config: one cooperative budget shared by every publishing tool. */
export interface Config {
  /** Cooperative tool-call timeout budget (ms). Defaults to 30000. */
  timeoutMs?: number
}

/** Loader schema for the publishing tools. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(30_000),
})

/**
 * Read the non-blank form of an optional settings field.
 * @param value - the settings field, when present.
 * @returns the trimmed value, or `undefined` when absent or blank.
 */
function text(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * Resolve the backend, account, and password one call uses.
 *
 * The settings view is read on every call, so a change on the settings page
 * takes effect without restarting the session. A missing deployment row, an
 * unset field, and an unset password each fail with the page that fixes them.
 * @param ctx - the tool plugin's context, whose `credentials` service resolves the password.
 * @param timeoutMs - the cooperative budget attached to the resolved target.
 * @returns the target for this call.
 * @throws GeoAdminError with code `unavailable` (no settings row), `unconfigured`
 *   (a field or the password is missing), never a silent default.
 */
async function resolveTarget(ctx: Context, timeoutMs: number): Promise<GeoAdminTarget> {
  const view = ctx.get('geoAdminSettings')
  if (view === undefined) {
    throw new GeoAdminError(
      'unavailable',
      'the geo-admin settings section is not mounted in this deployment, so no 深度云海 backend is configured',
    )
  }
  const section = view.get()
  const baseUrl = text(section.baseUrl)
  const username = text(section.username)
  if (baseUrl === undefined || username === undefined) {
    throw new GeoAdminError(
      'unconfigured',
      '深度云海 is not configured: open Settings → Plugins → 深度云海 and set the backend address and account',
    )
  }
  const password = await ctx.credentials.resolve(credentialRef(GEO_ADMIN_PASSWORD_REF))
  if (password === undefined) {
    throw new GeoAdminError(
      'unconfigured',
      `深度云海 has no stored password: open Settings → Plugins → 深度云海 and save the password (credential ${GEO_ADMIN_PASSWORD_REF})`,
    )
  }
  return { baseUrl, username, password: password.value, timeoutMs }
}

/**
 * Render a site list as one model-facing text block.
 * @param websites - the sites the account may publish to.
 * @returns the readable list.
 */
function formatSites(websites: readonly GeoWebsite[]): string {
  if (websites.length === 0) {
    return 'This account has no publishable sites. Ask an administrator to assign sites to it.'
  }
  const lines = websites.map((site) => {
    const details = [site.domain, site.code].filter((part): part is string => part !== undefined)
    const suffix = details.length === 0 ? '' : ` — ${details.join(' · ')}`
    const role = site.role === undefined ? '' : ` (role: ${site.role})`
    return `- id ${String(site.id)} · ${site.name}${suffix}${role}`
  })
  return ['Publishable sites:', ...lines].join('\n')
}

/**
 * Render one stored article as a model-facing text block.
 * @param article - the stored record.
 * @returns the readable summary.
 */
function formatArticle(article: GeoArticle): string {
  const state = article.is_published ? 'published' : 'draft'
  const slug = article.slug === undefined ? '' : ` slug: ${article.slug};`
  return `Article ${String(article.id)} "${article.title}" on site ${String(article.website_id)} — ${state};${slug}`
}

/**
 * Format the published article output value.
 * @param value - the tool output value.
 * @returns the model-facing text.
 */
function renderArticle(value: { article: GeoArticle }): string {
  return `Published and read back: ${formatArticle(value.article)}`
}

/**
 * Render one page of article summaries.
 * @param page - the page the list endpoint returned.
 * @returns the model-facing text.
 */
function formatNewsPage(page: GeoPage<GeoNewsSummary>): string {
  if (page.items.length === 0) return 'No articles match this query.'
  const lines = page.items.map((item) => {
    const state = item.is_published ? 'published' : 'draft'
    const slug = item.slug === undefined ? '' : ` slug: ${item.slug};`
    const updated = item.updated_at === undefined ? '' : ` updated: ${item.updated_at};`
    return `- ${String(item.id)} · ${item.title} · site ${String(item.website_id)} · ${state};${slug}${updated}`
  })
  return [`Articles (page ${String(page.page)}/${String(page.pages)}, ${String(page.total)} total):`, ...lines].join('\n')
}

/**
 * Render one page of categories.
 * @param page - the page the list endpoint returned.
 * @returns the model-facing text.
 */
function formatCategories(page: GeoPage<GeoCategory>): string {
  if (page.items.length === 0) return 'No categories match this query.'
  const lines = page.items.map((item) => {
    const site = item.website_id === undefined ? '' : ` · site ${String(item.website_id)}`
    const slug = item.slug === undefined ? '' : ` · ${item.slug}`
    const active = item.is_active === false ? ' (inactive)' : ''
    return `- ${String(item.id)} · ${item.name}${slug}${site}${active}`
  })
  return [`Categories (page ${String(page.page)}/${String(page.pages)}, ${String(page.total)} total):`, ...lines].join('\n')
}

/**
 * Render one page of GEO keyword tasks.
 * @param page - the page the dispatch route returned.
 * @returns the model-facing text.
 */
function formatTaskPage(page: GeoTaskPage): string {
  if (page.items.length === 0) return 'No GEO tasks match this query.'
  const lines = page.items.map((task) => {
    const site = task.website_id === undefined ? '' : ` · site ${String(task.website_id)}`
    const attempts = task.attempt_count === undefined || task.max_attempts === undefined
      ? ''
      : ` · attempt ${String(task.attempt_count)}/${String(task.max_attempts)}`
    const failure = task.last_error_message === undefined ? '' : ` · last error: ${task.last_error_message}`
    return `- ${task.id} · ${task.keyword} · ${task.platform} · ${task.status}${site}${attempts}${failure}`
  })
  return [`GEO tasks (page ${String(page.page)}, ${String(page.total)} total):`, ...lines].join('\n')
}

/**
 * Render the task one retry left behind.
 * @param task - the retried task.
 * @returns the model-facing text.
 */
function formatTaskRetry(task: GeoTaskRetry): string {
  const attempts = task.attempt_count === undefined || task.max_attempts === undefined
    ? ''
    : ` (attempt ${String(task.attempt_count)}/${String(task.max_attempts)})`
  return `Retried task ${task.id}${attempts}: status ${task.status}`
}

/**
 * Render one page of brand-visibility reports.
 * @param page - the page the report list returned.
 * @returns the model-facing text.
 */
function formatReportPage(page: GeoReportPage): string {
  if (page.items.length === 0) return 'No brand-visibility reports match this query.'
  const lines = page.items.map((item) => {
    const status = item.status === undefined ? '' : ` · ${item.status}`
    const generated = item.generated_at === undefined ? '' : ` · generated ${item.generated_at}`
    return `- ${item.id} · ${item.site_name} (site ${String(item.website_id)}) · ${String(item.total_qa_count)} QA · ${String(item.total_citation_count)} citations${status}${generated}`
  })
  return [`Brand-visibility reports (page ${String(page.page)}, ${String(page.total)} total):`, ...lines].join('\n')
}

/**
 * Render one stored report with its leading brands.
 * @param report - the projected report.
 * @returns the model-facing text.
 */
function formatReport(report: GeoReport): string {
  const header = `Report ${report.id} · ${report.site_name} (site ${String(report.website_id)}) · ${String(report.total_qa_count)} QA · ${String(report.total_citation_count)} citations`
  const window = report.qa_start_date === undefined || report.qa_end_date === undefined
    ? ''
    : ` · QA window ${report.qa_start_date} → ${report.qa_end_date}`
  const generated = report.generated_at === undefined ? '' : ` · generated ${report.generated_at}`
  const own = report.visibility_score === undefined ? '' : ` · own visibility ${String(report.visibility_score)}`
  const brands = report.brands.map((brand) => {
    const marker = brand.is_self ? ' (this brand)' : ''
    return `  - ${brand.name}${marker} · visibility ${String(brand.visibility_score)} · ${String(brand.mention_count)} mentions`
  })
  return [header + window + generated + own, ...brands.length === 0 ? [] : ['Brand ranking:', ...brands]].join('\n')
}

/**
 * Render one report-generation job.
 * @param job - the job.
 * @returns the model-facing text.
 */
function formatReportJob(job: GeoReportJob): string {
  const report = job.report_id === undefined ? '' : ` · report ${job.report_id}`
  const failure = job.error_message === undefined ? '' : ` · error: ${job.error_message}`
  return `Report job ${job.id}: ${job.status}${report}${failure}`
}

/** Output schema shared by the two article tools. */
const ARTICLE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    article: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        id: { type: 'number', required: true },
        title: { type: 'string', required: true },
        website_id: { type: 'number', required: true },
        is_published: { type: 'boolean', required: true },
        slug: { type: 'string' },
      },
    },
  },
} as const

/**
 * Register the three publishing tools. Registration is effect-scoped, so a
 * disposed preset fiber removes every tool.
 * @param ctx - the plugin context whose `tools` registry receives the tools.
 * @param config - the resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const timeoutMs = config.timeoutMs ?? 30_000

  ctx.tools.register(defineTool({
    name: 'geo_sites_list',
    description: 'List the 深度云海 sites the configured publishing account may publish articles to. Each site has an id, name, domain, and code; the id is the website_id an article is published to.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          websites: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'number', required: true },
                name: { type: 'string', required: true },
                code: { type: 'string' },
                domain: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSites(value.websites) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const target = await resolveTarget(ctx, timeoutMs)
      return { websites: await listWebsites(target, exec.signal) }
    },
    presentCall: (): GenericCallView => ({ card: 'generic', title: 'List 深度云海 sites', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_news_list',
    description: 'List 深度云海 articles, filtered by site, category, keyword, or publish state. Returns one page of id/title/site/state rows; use geo_article_get for the full article.',
    parameters: {
      website_id: { type: 'number', description: 'Restrict to one site id.' },
      category_id: { type: 'number', description: 'Restrict to one category id.' },
      search: { type: 'string', description: 'Case-insensitive keyword match over title, summary, and body.' },
      is_published: { type: 'boolean', description: 'true lists only live articles; false only drafts.' },
      page: { type: 'number', description: 'Page number, 1-based. Defaults to the backend\'s first page.' },
      limit: { type: 'number', description: 'Page size. Defaults to the backend\'s page size.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          news: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'number', required: true },
                title: { type: 'string', required: true },
                website_id: { type: 'number', required: true },
                is_published: { type: 'boolean', required: true },
                slug: { type: 'string' },
                category_id: { type: 'number' },
                created_at: { type: 'string' },
                updated_at: { type: 'string' },
              },
            },
          },
          total: { type: 'number', required: true },
          page: { type: 'number', required: true },
          limit: { type: 'number', required: true },
          pages: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatNewsPage({ items: value.news, total: value.total, page: value.page, limit: value.limit, pages: value.pages }),
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query: GeoNewsQuery = {
        ...(args.website_id === undefined ? {} : { website_id: args.website_id }),
        ...(args.category_id === undefined ? {} : { category_id: args.category_id }),
        ...(args.search === undefined ? {} : { search: args.search }),
        ...(args.is_published === undefined ? {} : { is_published: args.is_published }),
        ...(args.page === undefined ? {} : { page: args.page }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }
      const target = await resolveTarget(ctx, timeoutMs)
      const page = await listNews(target, query, exec.signal)
      return { news: page.items, total: page.total, page: page.page, limit: page.limit, pages: page.pages }
    },
    presentCall: () => ({ card: 'generic', title: 'List 深度云海 articles', kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_article_publish',
    description: 'Publish one article to a 深度云海 site. The body is markdown (the backend converts it to HTML) and the summary is plain text. Omit is_published for a draft; pass true only when the user asked to go live.',
    parameters: {
      website_id: { type: 'number', required: true, description: 'Target site id from geo_sites_list.' },
      title: { type: 'string', required: true, description: 'Article title.' },
      summary: { type: 'string', required: true, description: 'Plain-text summary; the backend strips HTML.' },
      content: { type: 'string', required: true, description: 'Markdown body with substantive content.' },
      tags: { type: 'string', description: 'Comma-separated tags.' },
      category_id: { type: 'number', description: 'Category id, when the target site uses one.' },
      image: { type: 'string', description: 'Cover image URL.' },
      author: { type: 'string', description: 'Byline.' },
      source: { type: 'string', description: 'Source attribution.' },
      source_url: { type: 'string', description: 'Source URL.' },
      is_published: { type: 'boolean', description: 'true goes live immediately; omitted stays a draft.' },
    },
    output: {
      schema: ARTICLE_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: renderArticle(value) }],
    },
    timeoutMs,
    // A create is not idempotent: serializing calls keeps one model step from
    // racing two creates against the same account.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft: GeoArticleDraft = {
        website_id: args.website_id,
        title: args.title,
        summary: args.summary,
        content: args.content,
        ...(args.tags === undefined ? {} : { tags: args.tags }),
        ...(args.category_id === undefined ? {} : { category_id: args.category_id }),
        ...(args.image === undefined ? {} : { image: args.image }),
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.source_url === undefined ? {} : { source_url: args.source_url }),
        ...(args.is_published === undefined ? {} : { is_published: args.is_published }),
      }
      const target = await resolveTarget(ctx, timeoutMs)
      return { article: await publishArticle(target, draft, exec.signal) }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Publish "${args.title}" to site ${String(args.website_id)}`,
      kind: 'edit',
      rawInput: { website_id: args.website_id, title: args.title },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_article_update',
    description: 'Change some fields of one existing 深度云海 article and read the stored record back. Only the fields passed change; pass is_published true to go live or false to return it to draft. Read the article first so the change is deliberate.',
    parameters: {
      id: { type: 'number', required: true, description: 'Article id to update.' },
      title: { type: 'string', description: 'New title.' },
      summary: { type: 'string', description: 'New plain-text summary.' },
      content: { type: 'string', description: 'New markdown body.' },
      tags: { type: 'string', description: 'Replacement comma-separated tags.' },
      category_id: { type: 'number', description: 'New category id.' },
      image: { type: 'string', description: 'New cover image URL.' },
      author: { type: 'string', description: 'New byline.' },
      source: { type: 'string', description: 'New source attribution.' },
      source_url: { type: 'string', description: 'New source URL.' },
      is_published: { type: 'boolean', description: 'true publishes, false returns the article to draft.' },
    },
    output: {
      schema: ARTICLE_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: `Updated and read back: ${formatArticle(value.article)}` }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const patch: GeoArticlePatch = {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.content === undefined ? {} : { content: args.content }),
        ...(args.tags === undefined ? {} : { tags: args.tags }),
        ...(args.category_id === undefined ? {} : { category_id: args.category_id }),
        ...(args.image === undefined ? {} : { image: args.image }),
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.source_url === undefined ? {} : { source_url: args.source_url }),
        ...(args.is_published === undefined ? {} : { is_published: args.is_published }),
      }
      if (Object.keys(patch).length === 0) {
        throw new Error('geo_article_update needs at least one field to change')
      }
      const target = await resolveTarget(ctx, timeoutMs)
      return { article: await updateArticle(target, args.id, patch, exec.signal) }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Update article ${String(args.id)}`,
      kind: 'edit',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_article_get',
    description: 'Read one 深度云海 article by id and report its stored title, site, slug, and publish state.',
    parameters: {
      id: { type: 'number', required: true, description: 'Article id returned by geo_article_publish.' },
    },
    output: {
      schema: ARTICLE_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: formatArticle(value.article) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = await resolveTarget(ctx, timeoutMs)
      return { article: await fetchArticle(target, args.id, exec.signal) }
    },
    presentCall: args => ({ card: 'generic', title: `Read article ${String(args.id)}`, kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_categories_list',
    description: 'List 深度云海 content categories, optionally scoped to one site or a keyword. Use it to pick a category_id for geo_article_publish or geo_article_update.',
    parameters: {
      website_id: { type: 'number', description: 'Restrict to one site id.' },
      search: { type: 'string', description: 'Case-insensitive keyword match over name, slug, and description.' },
      page: { type: 'number', description: 'Page number, 1-based. Defaults to the backend\'s first page.' },
      limit: { type: 'number', description: 'Page size. Defaults to the backend\'s page size.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          categories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'number', required: true },
                name: { type: 'string', required: true },
                website_id: { type: 'number' },
                slug: { type: 'string' },
                type: { type: 'string' },
                parent_id: { type: 'number' },
                is_active: { type: 'boolean' },
              },
            },
          },
          total: { type: 'number', required: true },
          page: { type: 'number', required: true },
          limit: { type: 'number', required: true },
          pages: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatCategories({
          items: value.categories, total: value.total, page: value.page, limit: value.limit, pages: value.pages,
        }),
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = await resolveTarget(ctx, timeoutMs)
      const page = await listCategories(target, {
        ...(args.website_id === undefined ? {} : { website_id: args.website_id }),
        ...(args.search === undefined ? {} : { search: args.search }),
        ...(args.page === undefined ? {} : { page: args.page }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }, exec.signal)
      return { categories: page.items, total: page.total, page: page.page, limit: page.limit, pages: page.pages }
    },
    presentCall: () => ({ card: 'generic', title: 'List 深度云海 categories', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_article_delete',
    description: 'Delete one 深度云海 article by id. Call it only when the user explicitly asked to delete THIS article: the backend refuses while publish or placement records reference it, and that refusal is reported as-is. Read the article first so the id is confirmed.',
    parameters: {
      id: { type: 'number', required: true, description: 'Article id to delete.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { article_id: { type: 'number', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Deleted article ${String(value.article_id)}.` }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const target = await resolveTarget(ctx, timeoutMs)
      await deleteArticle(target, args.id, exec.signal)
      return { article_id: args.id }
    },
    presentCall: args => ({ card: 'generic', title: `Delete article ${String(args.id)}`, kind: 'delete' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_tasks_list',
    description: 'List GEO keyword tasks (the questions a model is asked per site and platform) and their status. Filter by site, batch, platform, status, or keyword text; the result is one page of task rows.',
    parameters: {
      website_id: { type: 'number', description: 'Restrict to one site id.' },
      batch_id: { type: 'string', description: 'Restrict to one dispatch batch id.' },
      platform: { type: 'string', description: 'Restrict to one model platform, for example doubao.' },
      status: { type: 'string', description: 'Restrict to one status: pending, running, succeeded, failed, cancelled.' },
      q: { type: 'string', description: 'Keyword text to match.' },
      page: { type: 'number', description: 'Page number, 1-based.' },
      page_size: { type: 'number', description: 'Page size; the backend default is 20.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                keyword: { type: 'string', required: true },
                platform: { type: 'string', required: true },
                status: { type: 'string', required: true },
                website_id: { type: 'number' },
                batch_id: { type: 'string' },
                attempt_count: { type: 'number' },
                max_attempts: { type: 'number' },
                last_error_message: { type: 'string' },
                created_at: { type: 'string' },
                updated_at: { type: 'string' },
              },
            },
          },
          total: { type: 'number', required: true },
          page: { type: 'number', required: true },
          page_size: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatTaskPage({
          items: value.tasks, total: value.total, page: value.page, page_size: value.page_size,
        }),
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query: GeoTaskQuery = {
        ...(args.website_id === undefined ? {} : { website_id: args.website_id }),
        ...(args.batch_id === undefined ? {} : { batch_id: args.batch_id }),
        ...(args.platform === undefined ? {} : { platform: args.platform }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.q === undefined ? {} : { q: args.q }),
        ...(args.page === undefined ? {} : { page: args.page }),
        ...(args.page_size === undefined ? {} : { page_size: args.page_size }),
      }
      const target = await resolveTarget(ctx, timeoutMs)
      const page = await listTasks(target, query, exec.signal)
      return { tasks: page.items, total: page.total, page: page.page, page_size: page.page_size }
    },
    presentCall: () => ({ card: 'generic', title: 'List GEO tasks', kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_task_retry',
    description: 'Retry one failed GEO task by id. The backend refuses an unknown id and a task that already used its attempts; the refusal is reported as-is.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id from geo_tasks_list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              status: { type: 'string', required: true },
              attempt_count: { type: 'number' },
              max_attempts: { type: 'number' },
              platform: { type: 'string' },
              keyword: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatTaskRetry(value.task) }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const target = await resolveTarget(ctx, timeoutMs)
      return { task: await retryTask(target, args.id, exec.signal) }
    },
    presentCall: args => ({ card: 'generic', title: `Retry GEO task ${args.id}`, kind: 'edit' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_reports_list',
    description: 'List brand-visibility (GEO) reports across the account\'s sites, newest first as the backend orders them. Filter by site, status, source, or a generated-date range; the result is one page of report rows.',
    parameters: {
      website_id: { type: 'number', description: 'Restrict to one site id.' },
      site_name: { type: 'string', description: 'Site name to match.' },
      status: { type: 'string', description: 'Restrict to one report status.' },
      source: { type: 'string', description: 'Restrict to one report source, for example manual or scheduled.' },
      start_date: { type: 'string', description: 'Earliest generated date, YYYY-MM-DD.' },
      end_date: { type: 'string', description: 'Latest generated date, YYYY-MM-DD.' },
      page: { type: 'number', description: 'Page number, 1-based.' },
      page_size: { type: 'number', description: 'Page size; the backend default is 20.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reports: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                website_id: { type: 'number', required: true },
                site_name: { type: 'string', required: true },
                total_qa_count: { type: 'number', required: true },
                total_citation_count: { type: 'number', required: true },
                status: { type: 'string' },
                generated_at: { type: 'string' },
                submitted_at: { type: 'string' },
                source: { type: 'string' },
              },
            },
          },
          total: { type: 'number', required: true },
          page: { type: 'number', required: true },
          page_size: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatReportPage({
          items: value.reports, total: value.total, page: value.page, page_size: value.page_size,
        }),
      }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query: GeoReportQuery = {
        ...(args.website_id === undefined ? {} : { website_id: args.website_id }),
        ...(args.site_name === undefined ? {} : { site_name: args.site_name }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.start_date === undefined ? {} : { start_date: args.start_date }),
        ...(args.end_date === undefined ? {} : { end_date: args.end_date }),
        ...(args.page === undefined ? {} : { page: args.page }),
        ...(args.page_size === undefined ? {} : { page_size: args.page_size }),
      }
      const target = await resolveTarget(ctx, timeoutMs)
      const page = await listReports(target, query, exec.signal)
      return { reports: page.items, total: page.total, page: page.page, page_size: page.page_size }
    },
    presentCall: () => ({ card: 'generic', title: 'List brand-visibility reports', kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_report_get',
    description: 'Read one brand-visibility report by id: its QA and citation counts, QA window, the target brand\'s own visibility score, and the brand ranking. Use it to answer questions about a site\'s current AI-search visibility.',
    parameters: {
      id: { type: 'string', required: true, description: 'Report id from geo_reports_list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              website_id: { type: 'number', required: true },
              site_name: { type: 'string', required: true },
              total_qa_count: { type: 'number', required: true },
              total_citation_count: { type: 'number', required: true },
              cumulative_mention_count: { type: 'number' },
              generated_at: { type: 'string' },
              qa_start_date: { type: 'string' },
              qa_end_date: { type: 'string' },
              visibility_score: { type: 'number' },
              brands: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true },
                    is_self: { type: 'boolean', required: true },
                    visibility_score: { type: 'number', required: true },
                    mention_count: { type: 'number', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatReport(value.report) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = await resolveTarget(ctx, timeoutMs)
      return { report: await getReport(target, args.id, exec.signal) }
    },
    presentCall: args => ({ card: 'generic', title: `Read report ${args.id}`, kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_report_generate',
    description: 'Start one brand-visibility report generation for a site and return its job. Report generation costs model calls; confirm the site and QA window with the user first, then poll geo_report_job until the job finishes.',
    parameters: {
      website_id: { type: 'number', required: true, description: 'Site the report covers.' },
      qa_start_date: { type: 'string', description: 'QA window start, YYYY-MM-DD.' },
      qa_end_date: { type: 'string', description: 'QA window end, YYYY-MM-DD.' },
      source: { type: 'string', description: 'Source label recorded on the job; defaults to manual.' },
      force: { type: 'boolean', description: 'Regenerate even when the input matches an existing report.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          job: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              status: { type: 'string', required: true },
              website_id: { type: 'number' },
              report_id: { type: 'string' },
              error_message: { type: 'string' },
              source: { type: 'string' },
              created_at: { type: 'string' },
              started_at: { type: 'string' },
              finished_at: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatReportJob(value.job) }],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const request: GeoReportRequest = {
        website_id: args.website_id,
        ...(args.qa_start_date === undefined ? {} : { qa_start_date: args.qa_start_date }),
        ...(args.qa_end_date === undefined ? {} : { qa_end_date: args.qa_end_date }),
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.force === undefined ? {} : { force: args.force }),
      }
      const target = await resolveTarget(ctx, timeoutMs)
      return { job: await generateReport(target, request, exec.signal) }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Generate a report for site ${String(args.website_id)}`,
      kind: 'edit',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'geo_report_job',
    description: 'Read one report-generation job by id and report whether it is still running, produced a report, or failed.',
    parameters: {
      id: { type: 'string', required: true, description: 'Job id from geo_report_generate.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          job: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              status: { type: 'string', required: true },
              website_id: { type: 'number' },
              report_id: { type: 'string' },
              error_message: { type: 'string' },
              source: { type: 'string' },
              created_at: { type: 'string' },
              started_at: { type: 'string' },
              finished_at: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatReportJob(value.job) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const target = await resolveTarget(ctx, timeoutMs)
      return { job: await getReportJob(target, args.id, exec.signal) }
    },
    presentCall: args => ({ card: 'generic', title: `Read report job ${args.id}`, kind: 'read' }),
  }))
}
