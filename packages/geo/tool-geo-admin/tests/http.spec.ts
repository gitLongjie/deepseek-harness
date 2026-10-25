/**
 * The geo-admin HTTP client: sign-in, site listing, article create, and the
 * read-back that makes a create report the stored record. Every case drives the
 * real request builder through a scripted transport, so the asserted wire shape
 * and the narrowing of the backend's answers are the shipping code.
 */
import { describe, expect, it } from 'vitest'
import { GeoAdminError } from '../src/errors.ts'
import {
  deleteArticle, fetchArticle, generateReport, getReport, getReportJob, listReports, listTasks, listWebsites,
  publishArticle, retryTask, signIn,
  type GeoAdminTarget,
} from '../src/http.ts'

const TARGET: GeoAdminTarget = {
  baseUrl: 'http://localhost:8001',
  username: 'article-bot',
  password: 'pw',
  timeoutMs: 1_000,
}

const SIGNAL = new AbortController().signal

/** One scripted answer: a JSON body with a status, or a thrown transport failure. */
function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** One scripted transport: the replies it still owes, and every request it saw. */
interface ScriptedTransport {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  calls: [string, RequestInit][]
}

/** The URL text of whatever a fetch implementation was given. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** A transport that answers from a fixed queue and records every request. */
function transportOf(...responses: (Response | Error)[]): ScriptedTransport {
  const queue = [...responses]
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    transport.calls.push([urlOf(input), init ?? {}])
    const next = queue.shift()
    if (next === undefined) throw new Error('no scripted response left')
    if (next instanceof Error) throw next
    return next
  }) as ScriptedTransport
  transport.calls = []
  return transport
}

/** Parse one recorded request body, when it carried JSON. */
function bodyOf(init: RequestInit): unknown {
  return typeof init.body === 'string' ? JSON.parse(init.body) : undefined
}

/** Read one recorded request's URL, init, headers, and parsed body. */
function requestAt(transport: ScriptedTransport, index: number) {
  const call = transport.calls[index]
  if (call === undefined) throw new Error(`no request recorded at ${String(index)}`)
  const [url, init] = call
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    redirect: init.redirect,
    body: bodyOf(init),
  }}

describe('geo-admin HTTP client', () => {
  it('signs in and keeps every site field the backend reports', async () => {
    const transport = transportOf(answer({
      access_token: 'tok',
      websites: [{ id: 4, name: '主站', code: 'main', domain: 'example.com', role: 'editor' }],
    }))

    const result = await signIn(TARGET, SIGNAL, transport)

    expect(result.token).toBe('tok')
    expect(result.websites).toEqual([{ id: 4, name: '主站', code: 'main', domain: 'example.com', role: 'editor' }])
    const login = requestAt(transport, 0)
    expect(login.url).toBe('http://localhost:8001/api/v1/auth/login')
    expect(login.method).toBe('POST')
    expect(login.redirect).toBe('error')
    expect(login.body).toEqual({ username: 'article-bot', password: 'pw' })
  })

  it('treats a login response without a site list as no sites', async () => {
    const transport = transportOf(answer({ access_token: 'tok' }))

    expect((await signIn(TARGET, SIGNAL, transport)).websites).toEqual([])
  })

  it('drops absent optional site fields and tolerates a trailing base slash', async () => {
    const transport = transportOf(answer({
      access_token: 'tok',
      websites: [{ id: 1, name: 'only', code: '', domain: '   ' }],
    }))

    const result = await signIn({ ...TARGET, baseUrl: 'http://localhost:8001/' }, SIGNAL, transport)

    expect(result.websites).toEqual([{ id: 1, name: 'only' }])
    expect(requestAt(transport, 0).url).toBe('http://localhost:8001/api/v1/auth/login')
  })

  it('rejects a login answer without a token', async () => {
    const transport = transportOf(answer({ access_token: '   ' }))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toMatchObject({ code: 'response' })
    await expect(signIn(TARGET, SIGNAL, transportOf(answer({ access_token: '   ' }))))
      .rejects.toThrow(/access_token/)
  })

  it('rejects a body that is not a JSON object', async () => {
    const transport = transportOf(answer([1, 2]))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toMatchObject({ code: 'response' })
  })

  it('rejects a site list that is not an array', async () => {
    const transport = transportOf(answer({ access_token: 'tok', websites: 'none' }))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toThrow(/array of sites/)
  })

  it('rejects a site whose id is missing', async () => {
    const transport = transportOf(answer({ access_token: 'tok', websites: [{ name: 'x' }] }))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toThrow(/"id"/)
  })

  it('rejects a site field of the wrong type', async () => {
    const transport = transportOf(answer({ access_token: 'tok', websites: [{ id: 1, name: 'x', domain: 7 }] }))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toThrow(/"domain"/)
  })

  it('lists sites from the login answer without a second request', async () => {
    const transport = transportOf(answer({
      access_token: 'tok',
      websites: [{ id: 2, name: '二站' }],
    }))

    expect(await listWebsites(TARGET, SIGNAL, transport)).toEqual([{ id: 2, name: '二站' }])
    expect(transport.calls).toHaveLength(1)
  })

  it('falls back to the site endpoint when the login answer carries none', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok', websites: [] }),
      answer({ data: [{ id: 9, name: 'fallback' }], total: 1 }),
    )

    expect(await listWebsites(TARGET, SIGNAL, transport)).toEqual([{ id: 9, name: 'fallback' }])
    const fallback = requestAt(transport, 1)
    expect(fallback.url).toBe('http://localhost:8001/api/v1/websites')
    expect(fallback.method).toBe('GET')
    expect(fallback.headers.authorization).toBe('Bearer tok')
    expect(fallback.body).toBeUndefined()
  })

  it('reads one article as a signed-in account', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ success: true, data: { id: 12, slug: 's', title: 't', website_id: 4, is_published: false } }),
    )

    expect(await fetchArticle(TARGET, 12, SIGNAL, transport)).toEqual({
      id: 12, slug: 's', title: 't', website_id: 4, is_published: false,
    })
    expect(requestAt(transport, 1).url).toBe('http://localhost:8001/api/v1/news/12')
  })

  it('drops an absent slug', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ success: true, data: { id: 12, title: 't', website_id: 4, is_published: true } }),
    )

    expect((await fetchArticle(TARGET, 12, SIGNAL, transport)).slug).toBeUndefined()
  })

  it('rejects an article whose publish flag is missing', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ success: true, data: { id: 12, title: 't', website_id: 4 } }),
    )

    await expect(fetchArticle(TARGET, 12, SIGNAL, transport)).rejects.toThrow(/"is_published"/)
  })

  it('publishes, then reads the stored record back with the same token', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ success: true, data: { id: 33, title: 't', website_id: 4, is_published: false } }),
      answer({ success: true, data: { id: 33, slug: 'slug-33', title: 't', website_id: 4, is_published: false } }),
    )

    const article = await publishArticle(TARGET, {
      website_id: 4, title: 't', summary: 's', content: '# c', tags: 'a,b',
    }, SIGNAL, transport)

    expect(article).toEqual({ id: 33, slug: 'slug-33', title: 't', website_id: 4, is_published: false })
    const create = requestAt(transport, 1)
    expect(create.url).toBe('http://localhost:8001/api/v1/news')
    expect(create.method).toBe('POST')
    expect(create.body).toEqual({ website_id: 4, title: 't', summary: 's', content: '# c', tags: 'a,b' })
    expect(requestAt(transport, 2).headers.authorization).toBe('Bearer tok')
  })

  it('reports the backend message on a rejected request', async () => {
    const transport = transportOf(answer({ message: '无效的用户名或密码' }, 401))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toThrow(/401: 无效的用户名或密码/)
  })

  it('falls back to the raw body when a failure carries no message', async () => {
    const transport = transportOf(new Response('bad gateway', { status: 502 }))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toThrow(/502: bad gateway/)
  })

  it('names an empty failure body', async () => {
    const transport = transportOf(new Response('   ', { status: 500 }))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toThrow(/500: \(empty response\)/)
  })

  it('rejects a successful answer that is not JSON', async () => {
    const transport = transportOf(new Response('<html>', { status: 200 }))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toBeInstanceOf(GeoAdminError)
    await expect(signIn(TARGET, SIGNAL, transportOf(new Response('<html>', { status: 200 }))))
      .rejects.toThrow(/did not answer JSON/)
  })

  it('wraps a transport failure with the endpoint it tried', async () => {
    const transport = transportOf(new Error('fetch failed'))

    await expect(signIn(TARGET, SIGNAL, transport)).rejects.toThrow(/POST \/api\/v1\/auth\/login could not be completed: fetch failed/)
  })
})

describe('geo-admin deletion, tasks, and reports', () => {
  it('deletes an article and settles without a read-back', async () => {
    const transport = transportOf(answer({ access_token: 'tok' }), answer({ success: true }))

    await deleteArticle(TARGET, 12, SIGNAL, transport)

    const remove = requestAt(transport, 1)
    expect(remove.url).toBe('http://localhost:8001/api/v1/news/12')
    expect(remove.method).toBe('DELETE')
    expect(remove.headers.authorization).toBe('Bearer tok')
  })

  it('surfaces the backend refusal when a delete is blocked', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ message: '该文章已有合作媒体投稿记录' }, 409),
    )

    await expect(deleteArticle(TARGET, 12, SIGNAL, transport)).rejects.toThrow(/该文章已有合作媒体投稿记录/)
  })

  it('lists GEO tasks and reads a flexible numeric site id', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({
        page: 2,
        page_size: 20,
        total_count: 41,
        items: [{
          id: 't1', keyword: '深度云海怎么样', platform: 'doubao', status: 'failed',
          website_id: '4', batch_id: 'b1', attempt_count: 2, max_attempts: 3,
          last_error_message: '超时', created_at: '2026-10-01', updated_at: '2026-10-02',
        }],
      }),
    )

    const page = await listTasks(TARGET, { website_id: 4, status: 'failed', page: 2 }, SIGNAL, transport)

    expect(page.total).toBe(41)
    expect(page.items[0]).toMatchObject({ id: 't1', website_id: 4, attempt_count: 2, last_error_message: '超时' })
    const path = requestAt(transport, 1).url
    expect(path).toContain('/api/v1/geo-tasks?')
    expect(path).toContain('website_id=4')
    expect(path).toContain('status=failed')
  })

  it('drops absent optional task fields and rejects a malformed task page', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ page: 1, page_size: 20, total_count: 1, items: [{ id: 't2', keyword: 'k', platform: 'p', status: 'pending' }] }),
    )
    const page = await listTasks(TARGET, {}, SIGNAL, transport)
    expect(page.items[0]).toEqual({ id: 't2', keyword: 'k', platform: 'p', status: 'pending' })

    const malformed = transportOf(
      answer({ access_token: 'tok' }),
      answer({ page: 1, page_size: 20, total_count: 0, items: 'none' }),
    )
    await expect(listTasks(TARGET, {}, SIGNAL, malformed)).rejects.toThrow(/"items"/)

    const badSite = transportOf(
      answer({ access_token: 'tok' }),
      answer({ page: 1, page_size: 20, total_count: 1, items: [{ id: 't3', keyword: 'k', platform: 'p', status: 's', website_id: {} }] }),
    )
    await expect(listTasks(TARGET, {}, SIGNAL, badSite)).rejects.toThrow(/"website_id"/)
  })

  it('retries one GEO task', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ ok: true, task: { id: 't1', status: 'pending', attempt_count: 0, max_attempts: 3, platform: 'doubao', keyword: 'k' } }),
    )

    const task = await retryTask(TARGET, 't1', SIGNAL, transport)

    expect(task).toMatchObject({ id: 't1', status: 'pending', attempt_count: 0 })
    expect(requestAt(transport, 1).url).toBe('http://localhost:8001/api/v1/geo-tasks/t1/retry')
    expect(requestAt(transport, 1).method).toBe('POST')
  })

  it('surfaces the task server detail on a refused retry', async () => {
    const transport = transportOf(answer({ access_token: 'tok' }), answer({ detail: '已达最大重试次数' }, 409))

    await expect(retryTask(TARGET, 't1', SIGNAL, transport)).rejects.toThrow(/已达最大重试次数/)
  })

  it('lists reports through the task server envelope', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({
        code: 200,
        message: 'success',
        data: {
          page: 1,
          page_size: 20,
          total_count: 2,
          items: [{
            id: 'r1', website_id: 4, site_name: '主站', total_qa_count: 30, total_citation_count: 12,
            status: 'succeeded', generated_at: '2026-10-01T10:00:00Z', submitted_at: '2026-10-01T09:00:00Z', source: 'manual',
          }],
        },
      }),
    )

    const page = await listReports(TARGET, { website_id: 4, status: 'succeeded' }, SIGNAL, transport)

    expect(page.items[0]).toMatchObject({ id: 'r1', site_name: '主站', total_qa_count: 30 })
    const path = requestAt(transport, 1).url
    expect(path).toContain('/api/v1/brand-visibility/admin/reports?')
    expect(path).toContain('website_id=4')
  })

  it('rejects a report page without its envelope payload', async () => {
    const transport = transportOf(answer({ access_token: 'tok' }), answer({ code: 200, message: 'success' }))

    await expect(listReports(TARGET, {}, SIGNAL, transport)).rejects.toThrow(/no "data"/)
  })

  it('reads one report and projects the target brand score', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({
        code: 200,
        data: {
          website_id: 4,
          site_name: '主站',
          total_qa_count: 30,
          total_citation_count: 12,
          cumulative_mention_count: 88,
          generated_at: '2026-10-01T10:00:00Z',
          qa_start_date: '2026-09-01',
          qa_end_date: '2026-09-30',
          rankings: [
            { brand_name: '别的品牌', is_self: false, visibility_score: 70, mention_count: 20 },
            { brand_name: '深度云海', is_self: true, visibility_score: 55.5, mention_count: 9 },
          ],
        },
      }),
    )

    const report = await getReport(TARGET, 'r1', SIGNAL, transport)

    expect(report.id).toBe('r1')
    expect(report.visibility_score).toBe(55.5)
    expect(report.brands).toHaveLength(2)
    expect(report.brands[1]).toEqual({ name: '深度云海', is_self: true, visibility_score: 55.5, mention_count: 9 })
    expect(requestAt(transport, 1).url).toBe('http://localhost:8001/api/v1/brand-visibility/admin/reports/r1')
  })

  it('drops an absent optional report field and rejects a report without rankings', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ code: 200, data: { website_id: 4, site_name: '主站', total_qa_count: 1, total_citation_count: 0, rankings: [] } }),
    )
    const report = await getReport(TARGET, 'r2', SIGNAL, transport)
    expect(report.visibility_score).toBeUndefined()
    expect(report.generated_at).toBeUndefined()

    const malformed = transportOf(
      answer({ access_token: 'tok' }),
      answer({ code: 200, data: { website_id: 4, site_name: '主站', total_qa_count: 1, total_citation_count: 0 } }),
    )
    await expect(getReport(TARGET, 'r3', SIGNAL, malformed)).rejects.toThrow(/"rankings"/)
  })

  it('starts a report generation and reads its job', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ code: 200, data: { id: 'j1', website_id: 4, status: 'running', source: 'manual', created_at: '2026-10-01' } }),
      answer({ access_token: 'tok' }),
      answer({ code: 200, data: { id: 'j1', website_id: 4, status: 'succeeded', report_id: 'r9' } }),
    )

    const started = await generateReport(TARGET, { website_id: 4, qa_start_date: '2026-09-01', force: true }, SIGNAL, transport)
    expect(started).toMatchObject({ id: 'j1', status: 'running' })

    const path = requestAt(transport, 1).url
    expect(path).toContain('/api/v1/brand-visibility/report/generate?')
    expect(path).toContain('qa_start_date=2026-09-01')
    expect(path).toContain('force=true')
    expect(path).toContain('run_async=true')

    const settled = await getReportJob(TARGET, 'j1', SIGNAL, transport)
    expect(settled).toMatchObject({ status: 'succeeded', report_id: 'r9' })
  })

  it('omits force when it is false and rejects a job without an id', async () => {
    const transport = transportOf(
      answer({ access_token: 'tok' }),
      answer({ code: 200, data: { id: 'j2', status: 'queued' } }),
    )
    await generateReport(TARGET, { website_id: 5, force: false }, SIGNAL, transport)
    expect(requestAt(transport, 1).url).not.toContain('force=')

    const malformed = transportOf(answer({ access_token: 'tok' }), answer({ code: 200, data: { status: 'queued' } }))
    await expect(getReportJob(TARGET, 'j3', SIGNAL, malformed)).rejects.toThrow(/"id"/)
  })

  it('reads a null page or ranking list as no rows', async () => {
    const tasks = transportOf(
      answer({ access_token: 'tok' }),
      answer({ page: 1, page_size: 20, total_count: 0, items: null }),
    )
    expect((await listTasks(TARGET, {}, SIGNAL, tasks)).items).toEqual([])

    const reports = transportOf(
      answer({ access_token: 'tok' }),
      answer({ code: 200, data: { page: 1, page_size: 20, total_count: 0, items: null } }),
    )
    expect((await listReports(TARGET, {}, SIGNAL, reports)).items).toEqual([])

    const report = transportOf(
      answer({ access_token: 'tok' }),
      answer({
        code: 200,
        data: { website_id: 4, site_name: '主站', total_qa_count: 0, total_citation_count: 0, rankings: null },
      }),
    )
    const empty = await getReport(TARGET, 'r4', SIGNAL, report)
    expect(empty.brands).toEqual([])
    expect(empty.visibility_score).toBeUndefined()
  })
})
