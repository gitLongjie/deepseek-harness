/**
 * The 深度云海 tools driven through the real tool registry: the settings
 * namespace, the credential store, and the registered schemas are the shipping
 * code; only the backend's HTTP answers are scripted.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolPlugin from '../src/index.ts'
import type { GeoArticle, GeoWebsite } from '../src/index.ts'
import * as settingsPlugin from '../src/settings.ts'
import { GEO_ADMIN_PASSWORD_REF } from '../src/settings.ts'

const SIGNAL = new AbortController().signal

/** One in-memory settings document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Everything one test owns, torn down together. */
interface Harness {
  ctx: Context
  dir: string
  calls: [string, RequestInit][]
}

let active: Harness | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  if (active !== undefined) {
    await active.ctx.fiber.dispose()
    rmSync(active.dir, { recursive: true, force: true })
    active = undefined
  }
})

/** A scripted backend: answers from a queue and records into the harness. */
function backend(...responses: unknown[]): void {
  const queue = [...responses]
  const calls = active?.calls ?? []
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init])
    const next = queue.shift()
    if (next instanceof Response) return next
    return new Response(JSON.stringify(next), { status: 200 })
  })
  vi.stubGlobal('fetch', transport)
}

/** A JSON answer with a status. */
function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/**
 * Mount the settings entry, a local credential store, the tool registry, and
 * the 深度云海 tools.
 * @param options - what to mount and which account to store.
 * @returns the harness the test drives.
 */
async function harness(
  options: { mountSettings?: boolean; baseUrl?: string; username?: string; password?: string } = {},
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'geo-admin-tools-'))
  const ctx = new Context()
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CredentialsLocal, { path: join(dir, '.credentials.yaml'), watch: false })
  if (options.mountSettings ?? true) await ctx.plugin(settingsPlugin, {})
  await ctx.plugin(toolPlugin, {})
  const harnessed: Harness = { ctx, dir, calls: [] }
  active = harnessed
  if ((options.mountSettings ?? true) && options.baseUrl !== undefined) {
    await ctx.settings.update('geo-admin', { baseUrl: options.baseUrl, username: options.username ?? 'article-bot' })
  }
  if (options.password !== undefined) {
    await ctx.credentials.set(credentialRef(GEO_ADMIN_PASSWORD_REF), options.password)
  }
  return harnessed
}

let callSeq = 0

/**
 * Execute one registered tool through the real registry.
 * @param ctx - the mounted context.
 * @param name - the tool name.
 * @param args - the model-facing arguments.
 * @returns the registry's result.
 */
async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: SIGNAL,
    callId: ToolCallId(`geo-call-${++callSeq}`),
    name,
    arguments: args,
  })
}

/**
 * Read the rendered text of one tool result.
 * @param result - the registry result.
 * @returns the concatenated text blocks.
 */
function contentText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('深度云海 tools', () => {
  it('registers every publishing and content tool', async () => {
    const { ctx } = await harness()
    expect(ctx.tools.schemas().map(schema => schema.name).sort())
      .toEqual([
        'geo_article_delete',
        'geo_article_get',
        'geo_article_publish',
        'geo_article_update',
        'geo_categories_list',
        'geo_news_list',
        'geo_report_generate',
        'geo_report_get',
        'geo_report_job',
        'geo_reports_list',
        'geo_sites_list',
        'geo_task_retry',
        'geo_tasks_list',
      ])
  })

  it('lists the sites the account may publish to', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend({
      access_token: 'tok',
      websites: [
        { id: 4, name: '主站', domain: 'example.com', code: 'main', role: 'editor' },
        { id: 5, name: '只有名字' },
      ],
    })

    const result = await call(ctx, 'geo_sites_list', {})

    if (result.isError) throw new Error('expected a successful site list')
    expect((result.value as unknown as { websites: GeoWebsite[] }).websites).toEqual([
      { id: 4, name: '主站', domain: 'example.com', code: 'main', role: 'editor' },
      { id: 5, name: '只有名字' },
    ])
    expect(contentText(result)).toContain('id 4 · 主站 — example.com · main (role: editor)')
    expect(contentText(result)).toContain('id 5 · 只有名字')
  })

  it('reports an account with no publishable sites', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend({ access_token: 'tok', websites: [] }, { data: [] })

    const result = await call(ctx, 'geo_sites_list', {})

    if (result.isError) throw new Error('expected a successful site list')
    expect(contentText(result)).toContain('no publishable sites')
  })

  it('publishes an article and reports the stored record', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend(
      { access_token: 'tok' },
      { success: true, data: { id: 33, title: '标题', website_id: 4, is_published: false } },
      { success: true, data: { id: 33, slug: 'biao-ti', title: '标题', website_id: 4, is_published: false } },
    )

    const result = await call(ctx, 'geo_article_publish', {
      website_id: 4,
      title: '标题',
      summary: '摘要',
      content: '# 正文',
      tags: 'a,b',
    })

    if (result.isError) throw new Error('expected a successful publish')
    expect((result.value as unknown as { article: GeoArticle }).article).toEqual({
      id: 33, slug: 'biao-ti', title: '标题', website_id: 4, is_published: false,
    })
    expect(contentText(result))
      .toContain('Published and read back: Article 33 "标题" on site 4 — draft; slug: biao-ti;')
  })

  it('reads one article by id', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend(
      { access_token: 'tok' },
      { success: true, data: { id: 7, slug: 's7', title: 'live', website_id: 4, is_published: true } },
    )

    const result = await call(ctx, 'geo_article_get', { id: 7 })

    if (result.isError) throw new Error('expected a successful read')
    expect(contentText(result)).toBe('Article 7 "live" on site 4 — published; slug: s7;')
  })

  it('describes a draft article without a slug when the backend reports none', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend(
      { access_token: 'tok' },
      { success: true, data: { id: 8, title: 'draft', website_id: 4, is_published: false } },
    )

    const result = await call(ctx, 'geo_article_get', { id: 8 })

    if (result.isError) throw new Error('expected a successful read')
    expect(contentText(result)).toBe('Article 8 "draft" on site 4 — draft;')
  })

  it('lists articles with the requested filters in the query string', async () => {
    const { ctx, calls } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend({ access_token: 'tok' }, {
      data: [
        {
          id: 1, title: '第一篇', website_id: 4, is_published: true,
          slug: 's1', category_id: 3, created_at: '2026-01-01', updated_at: '2026-01-02',
        },
        { id: 2, title: '第二篇', website_id: 4, is_published: false },
      ],
      total: 2, page: 1, limit: 20, pages: 1,
    })

    const result = await call(ctx, 'geo_news_list', {
      website_id: 4, search: '关键', is_published: true, page: 1, limit: 20,
    })

    if (result.isError) throw new Error('expected a successful list')
    expect((result.value as { total: number }).total).toBe(2)
    expect((result.value as { news: Record<string, unknown>[] }).news[0])
      .toMatchObject({ id: 1, slug: 's1', category_id: 3 })
    expect(calls[1]?.[0]).toContain('/api/v1/news?')
    expect(calls[1]?.[0]).toContain('website_id=4')
    expect(calls[1]?.[0]).toContain('is_published=true')
    expect(contentText(result)).toContain('Articles (page 1/1, 2 total):')
    expect(contentText(result)).toContain('1 · 第一篇 · site 4 · published; slug: s1; updated: 2026-01-02;')
  })

  it('reports an empty article page', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend({ access_token: 'tok' }, { data: [], total: 0, page: 1, limit: 20, pages: 0 })

    const result = await call(ctx, 'geo_news_list', {})

    if (result.isError) throw new Error('expected a successful list')
    expect(contentText(result)).toBe('No articles match this query.')
  })

  it('updates an article and reads the stored record back', async () => {
    const { ctx, calls } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend(
      { access_token: 'tok' },
      { success: true, data: { id: 7, title: '新标题', website_id: 4, is_published: true } },
      { success: true, data: { id: 7, slug: 's7', title: '新标题', website_id: 4, is_published: true } },
    )

    const result = await call(ctx, 'geo_article_update', { id: 7, title: '新标题', is_published: true })

    if (result.isError) throw new Error('expected a successful update')
    expect((result.value as unknown as { article: GeoArticle }).article)
      .toMatchObject({ id: 7, title: '新标题', is_published: true })
    expect(calls[1]?.[0]).toBe('http://localhost:8001/api/v1/news/7')
    expect(calls[1]?.[1].method).toBe('PUT')
    const body = calls[1]?.[1].body
    expect(typeof body === 'string' ? JSON.parse(body) : undefined)
      .toEqual({ title: '新标题', is_published: true })
    expect(contentText(result))
      .toContain('Updated and read back: Article 7 "新标题" on site 4 — published; slug: s7;')
  })

  it('refuses an update with no field to change', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })

    const result = await call(ctx, 'geo_article_update', { id: 7 })

    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.message).toContain('at least one field')
  })

  it('lists categories and reports an empty page', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend(
      { access_token: 'tok' },
      {
        data: [{ id: 3, name: '行业观察', slug: 'industry', website_id: 4, is_active: false }],
        total: 1, page: 1, limit: 20, pages: 1,
      },
    )
    const listed = await call(ctx, 'geo_categories_list', { website_id: 4 })
    if (listed.isError) throw new Error('expected a successful list')
    expect(contentText(listed)).toContain('3 · 行业观察 · industry · site 4 (inactive)')

    backend({ access_token: 'tok' }, { data: [], total: 0, page: 1, limit: 20, pages: 0 })
    const empty = await call(ctx, 'geo_categories_list', {})
    if (empty.isError) throw new Error('expected a successful list')
    expect(contentText(empty)).toBe('No categories match this query.')
  })

  it('sends the bearer token and refuses redirects on every request', async () => {
    const { ctx, calls } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend(
      { access_token: 'tok' },
      { success: true, data: { id: 1, title: 't', website_id: 4, is_published: false } },
    )

    await call(ctx, 'geo_article_get', { id: 1 })

    expect(calls).toHaveLength(2)
    for (const [, init] of calls) expect(init.redirect).toBe('error')
    expect(calls[1]?.[1].headers).toMatchObject({ authorization: 'Bearer tok' })
  })

  it('fails loud when the deployment mounts no settings entry', async () => {
    const { ctx } = await harness({ mountSettings: false })

    const result = await call(ctx, 'geo_sites_list', {})

    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.message).toContain('not mounted')
  })

  it('names the settings page when the account is unset', async () => {
    const { ctx } = await harness()
    await ctx.settings.update('geo-admin', { baseUrl: 'http://localhost:8001' })

    const result = await call(ctx, 'geo_sites_list', {})

    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.message).toContain('Settings → Plugins → 深度云海')
  })

  it('names the password reference when no password is stored', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001' })

    const result = await call(ctx, 'geo_sites_list', {})

    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.message).toContain(GEO_ADMIN_PASSWORD_REF)
  })

  it('surfaces the backend message on a rejected request', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend(answer({ message: '用户名或密码错误' }, 401))

    const result = await call(ctx, 'geo_sites_list', {})

    if (!result.isError) throw new Error('expected a failure')
    expect(result.error.message).toContain('用户名或密码错误')
  })

  it('presents each call with a readable title', async () => {
    const { ctx } = await harness()

    expect(ctx.tools.get('geo_article_publish')?.presentCall?.({ website_id: 4, title: '标题', summary: 's', content: 'c' }))
      .toEqual({
        card: 'generic',
        title: 'Publish "标题" to site 4',
        kind: 'edit',
        rawInput: { website_id: 4, title: '标题' },
      })
    expect(ctx.tools.get('geo_article_get')?.presentCall?.({ id: 7 }))
      .toEqual({ card: 'generic', title: 'Read article 7', kind: 'read' })
    expect(ctx.tools.get('geo_article_update')?.presentCall?.({ id: 7 }))
      .toEqual({ card: 'generic', title: 'Update article 7', kind: 'edit' })
    expect(ctx.tools.get('geo_sites_list')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'List 深度云海 sites', kind: 'read' })
    expect(ctx.tools.get('geo_news_list')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'List 深度云海 articles', kind: 'search' })
    expect(ctx.tools.get('geo_categories_list')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'List 深度云海 categories', kind: 'read' })
    expect(ctx.tools.get('geo_article_delete')?.presentCall?.({ id: 7 }))
      .toEqual({ card: 'generic', title: 'Delete article 7', kind: 'delete' })
    expect(ctx.tools.get('geo_tasks_list')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'List GEO tasks', kind: 'search' })
    expect(ctx.tools.get('geo_task_retry')?.presentCall?.({ id: 't1' }))
      .toEqual({ card: 'generic', title: 'Retry GEO task t1', kind: 'edit' })
    expect(ctx.tools.get('geo_reports_list')?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'List brand-visibility reports', kind: 'search' })
    expect(ctx.tools.get('geo_report_get')?.presentCall?.({ id: 'r1' }))
      .toEqual({ card: 'generic', title: 'Read report r1', kind: 'read' })
    expect(ctx.tools.get('geo_report_generate')?.presentCall?.({ website_id: 4 }))
      .toEqual({ card: 'generic', title: 'Generate a report for site 4', kind: 'edit' })
    expect(ctx.tools.get('geo_report_job')?.presentCall?.({ id: 'j1' }))
      .toEqual({ card: 'generic', title: 'Read report job j1', kind: 'read' })
  })

  it('deletes one article and reports the backend refusal', async () => {
    const { ctx, calls } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend({ access_token: 'tok' }, { success: true })

    const result = await call(ctx, 'geo_article_delete', { id: 12 })
    if (result.isError) throw new Error('expected a successful delete')
    expect(contentText(result)).toBe('Deleted article 12.')
    expect(calls[1]?.[0]).toBe('http://localhost:8001/api/v1/news/12')
    expect(calls[1]?.[1].method).toBe('DELETE')

    backend({ access_token: 'tok' }, answer({ message: '该文章已有合作媒体投稿记录' }, 409))
    const refused = await call(ctx, 'geo_article_delete', { id: 12 })
    if (!refused.isError) throw new Error('expected a refusal')
    expect(refused.error.message).toContain('已有合作媒体投稿记录')
  })

  it('lists GEO tasks and retries one', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend({ access_token: 'tok' }, {
      page: 1, page_size: 20, total_count: 1,
      items: [{
        id: 't1', keyword: '深度云海怎么样', platform: 'doubao', status: 'failed', website_id: '4',
        attempt_count: 2, max_attempts: 3, last_error_message: '超时',
      }],
    })

    const listed = await call(ctx, 'geo_tasks_list', { website_id: 4, status: 'failed' })
    if (listed.isError) throw new Error('expected a successful task list')
    const text = contentText(listed)
    expect(text).toContain('GEO tasks (page 1, 1 total):')
    expect(text).toContain('t1 · 深度云海怎么样 · doubao · failed · site 4 · attempt 2/3 · last error: 超时')

    backend({ access_token: 'tok' }, { ok: true, task: { id: 't1', status: 'pending', attempt_count: 0, max_attempts: 3 } })
    const retried = await call(ctx, 'geo_task_retry', { id: 't1' })
    if (retried.isError) throw new Error('expected a successful retry')
    expect(contentText(retried)).toBe('Retried task t1 (attempt 0/3): status pending')
  })

  it('lists reports, reads one, and follows a generation job', async () => {
    const { ctx } = await harness({ baseUrl: 'http://localhost:8001', password: 'pw' })
    backend({ access_token: 'tok' }, {
      code: 200,
      data: {
        page: 1, page_size: 20, total_count: 1,
        items: [{
          id: 'r1', website_id: 4, site_name: '主站', total_qa_count: 30, total_citation_count: 12,
          status: 'succeeded', generated_at: '2026-10-01',
        }],
      },
    })

    const listed = await call(ctx, 'geo_reports_list', { website_id: 4 })
    if (listed.isError) throw new Error('expected a successful report list')
    expect(contentText(listed)).toContain('r1 · 主站 (site 4) · 30 QA · 12 citations · succeeded · generated 2026-10-01')

    backend({ access_token: 'tok' }, {
      code: 200,
      data: {
        website_id: 4, site_name: '主站', total_qa_count: 30, total_citation_count: 12,
        qa_start_date: '2026-09-01', qa_end_date: '2026-09-30', generated_at: '2026-10-01',
        rankings: [
          { brand_name: '别的品牌', is_self: false, visibility_score: 70, mention_count: 20 },
          { brand_name: '深度云海', is_self: true, visibility_score: 55.5, mention_count: 9 },
        ],
      },
    })
    const read = await call(ctx, 'geo_report_get', { id: 'r1' })
    if (read.isError) throw new Error('expected a successful report read')
    expect(contentText(read)).toContain('own visibility 55.5')
    expect(contentText(read)).toContain('深度云海 (this brand) · visibility 55.5 · 9 mentions')

    backend({ access_token: 'tok' }, { code: 200, data: { id: 'j1', website_id: 4, status: 'running' } })
    const started = await call(ctx, 'geo_report_generate', { website_id: 4, force: true })
    if (started.isError) throw new Error('expected a successful generation start')
    expect(contentText(started)).toBe('Report job j1: running')

    backend({ access_token: 'tok' }, { code: 200, data: { id: 'j1', status: 'failed', error_message: '数据不足' } })
    const job = await call(ctx, 'geo_report_job', { id: 'j1' })
    if (job.isError) throw new Error('expected a successful job read')
    expect(contentText(job)).toBe('Report job j1: failed · error: 数据不足')
  })
})
