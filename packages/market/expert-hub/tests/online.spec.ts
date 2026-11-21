import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishExpert, type ExpertPublisher } from '@deepseek-ai/dsh-expert-publish/src/publish.ts'
import {
  fetchExpertPlaza, installedExpertVersions, installExpertModule, publishExpertDocument, publishLocalExpert,
  readRemoteExpert, uploadableExpertIds, versionRows,
} from '../src/online.ts'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'expert-hub-'))
  directories.push(path)
  return path
}

function publisher(directory: string): ExpertPublisher {
  const owned = new Map<string, () => Promise<void>>()
  const ids: string[] = []
  return {
    root: directory,
    owned,
    async register(definition) {
      ids.push(definition.id)
      return async () => {
        const index = ids.indexOf(definition.id)
        if (index >= 0) ids.splice(index, 1)
      }
    },
    async hasId(id) {
      return ids.includes(id)
    },
  }
}

const DRAFT = {
  id: 'geo-prelaunch',
  name: '示例专家',
  description: '做一件具体的事',
  persona: '你是示例专家。',
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('online expert modules', () => {
  it('uploads a local expert and records the plaza slug', async () => {
    const directory = await root()
    const live = publisher(directory)
    await publishExpert(live, DRAFT)
    const calls: { url: string; body: string | undefined }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : undefined })
      return jsonResponse({ success: true, data: { slug: 'u7-geo-prelaunch', version: '1.0.0' }, message: '已发布到专家广场' })
    }
    await expect(publishLocalExpert('https://example.test', 'token', live, DRAFT.id, fetchImpl))
      .resolves.toEqual({ ok: true, slug: 'u7-geo-prelaunch', version: '1.0.0' })
    expect(calls[0]?.url).toBe('https://example.test/api/expert-hub/items')
    const saved = JSON.parse(await readFile(join(directory, DRAFT.id, 'expert.json'), 'utf8')) as {
      origin: string
      remoteSlug: string
      version: string
    }
    expect(saved).toMatchObject({ origin: 'mine', remoteSlug: 'u7-geo-prelaunch', version: '1.0.0' })
    await expect(uploadableExpertIds(directory)).resolves.toEqual([DRAFT.id])
  })

  it('bumps the patch once when the server already has that version', async () => {
    const directory = await root()
    const live = publisher(directory)
    await publishExpert(live, { ...DRAFT, version: '1.0.0' })
    const versions: string[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { version: string }
      versions.push(body.version)
      if (body.version === '1.0.0') {
        return jsonResponse({ success: false, message: '版本 1.0.0 已存在，请提升版本后再上传' })
      }
      return jsonResponse({ success: true, data: { slug: 'u7-geo-prelaunch', version: body.version } })
    }
    await expect(publishLocalExpert('https://example.test', 'token', live, DRAFT.id, fetchImpl))
      .resolves.toEqual({ ok: true, slug: 'u7-geo-prelaunch', version: '1.0.1' })
    expect(versions).toEqual(['1.0.0', '1.0.1'])
  })

  it('refuses to upload a plaza install', async () => {
    const directory = await root()
    const live = publisher(directory)
    await publishExpert(live, { ...DRAFT, id: 'u7-geo-prelaunch', origin: 'plaza', remoteSlug: 'u7-geo-prelaunch' })
    const fetchImpl: typeof fetch = async () => {
      throw new Error('should not upload')
    }
    await expect(publishLocalExpert('https://example.test', 'token', live, 'u7-geo-prelaunch', fetchImpl))
      .resolves.toEqual({ ok: false, message: '从广场安装的专家不能再上传' })
    await expect(uploadableExpertIds(directory)).resolves.toEqual([])
  })

  it('installs a plaza module under its slug', async () => {
    const directory = await root()
    const live = publisher(directory)
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe('https://example.test/api/expert-hub/items/u7-geo-prelaunch/module')
      return jsonResponse({
        success: true,
        data: {
          slug: 'u7-geo-prelaunch',
          version: '1.2.0',
          name: '示例专家',
          description: '做一件具体的事',
          persona: '你是示例专家。',
          category: 'Marketing',
        },
      })
    }
    await expect(installExpertModule('https://example.test', live, 'u7-geo-prelaunch', fetchImpl))
      .resolves.toEqual({ ok: true, slug: 'u7-geo-prelaunch', version: '1.2.0' })
    const saved = JSON.parse(await readFile(join(directory, 'u7-geo-prelaunch', 'expert.json'), 'utf8')) as {
      origin: string
      category: string
    }
    expect(saved.origin).toBe('plaza')
    expect(saved.category).toBe('marketing')
  })

  it('uploads a document that is not stored locally and retries the next patch', async () => {
    const versions: string[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { version: string; persona: string }
      versions.push(body.version)
      expect(body.persona).toBe('你是顾问。')
      if (body.version === '1.0.0') return jsonResponse({ success: false, message: '版本 1.0.0 已存在，请提升版本后再上传' })
      return jsonResponse({ success: true, data: { slug: 'u7-geo-optimizer', version: body.version } })
    }
    await expect(publishExpertDocument('https://example.test', 'token', {
      id: 'geo-optimizer',
      name: 'GEO 优化专家',
      description: '诊断可见度。',
      persona: '你是顾问。',
      skillMarkdown: '',
      category: 'marketing',
      subtitle: '官方',
      icon: '🔍',
      tags: ['GEO'],
      quickPrompts: ['先诊断'],
      version: '1.0.0',
    }, fetchImpl)).resolves.toEqual({ ok: true, slug: 'u7-geo-optimizer', version: '1.0.1' })
    expect(versions).toEqual(['1.0.0', '1.0.1'])
  })

  it('reads a remote module and ignores an id that cannot be requested', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe('https://example.test/api/expert-hub/items/u7-geo/module')
      return jsonResponse({
        success: true,
        data: { name: '广场专家', description: '说明', persona: '人设', version: '1.0.0', skill_markdown: '---\nname: 技能\n---\n' },
      })
    }
    await expect(readRemoteExpert('https://example.test', 'u7-geo', fetchImpl)).resolves.toMatchObject({
      slug: 'u7-geo',
      persona: '人设',
    })
    await expect(readRemoteExpert('https://example.test', 'Bad Id', fetchImpl)).resolves.toBeUndefined()
    const refused: typeof fetch = async () => jsonResponse({ success: false, message: '没有' })
    await expect(readRemoteExpert('https://example.test', 'u7-geo', refused)).resolves.toBeUndefined()
  })

  it('reports a missing file, a refused upload, and a roster that already has the id', async () => {
    const directory = await root()
    const live = publisher(directory)
    const fetchImpl: typeof fetch = async () => jsonResponse({ success: false, message: '拒绝' })
    await expect(publishLocalExpert('https://example.test', 'token', live, 'missing', fetchImpl))
      .resolves.toEqual({ ok: false, message: '这个专家还没有保存在本机，不能上传' })
    await publishExpert(live, DRAFT)
    await expect(publishLocalExpert('https://example.test', 'token', live, DRAFT.id, fetchImpl))
      .resolves.toEqual({ ok: false, message: '拒绝' })
    const blocking = publisher(directory)
    blocking.hasId = async () => true
    const accepted: typeof fetch = async () => jsonResponse({ success: true, data: { slug: 'u7-geo-prelaunch', version: '1.0.0' } })
    await expect(publishLocalExpert('https://example.test', 'token', blocking, DRAFT.id, accepted))
      .resolves.toEqual({ ok: false, message: 'id "geo-prelaunch" is already on the roster' })
  })

  it('rejects an install that is incomplete and a document the server does not name', async () => {
    const directory = await root()
    const live = publisher(directory)
    const refused: typeof fetch = async () => jsonResponse({ success: false, message: '没有' })
    await expect(installExpertModule('https://example.test', live, 'Bad', refused))
      .resolves.toEqual({ ok: false, message: '专家 id 不能安装到本机名单' })
    await expect(installExpertModule('https://example.test', live, 'u7-geo', refused))
      .resolves.toEqual({ ok: false, message: '没有' })
    const empty: typeof fetch = async () => jsonResponse({ success: true })
    await expect(installExpertModule('https://example.test', live, 'u7-geo', empty))
      .resolves.toEqual({ ok: false, message: '专家内容是空的' })
    const nameless: typeof fetch = async () => jsonResponse({ success: true, data: { name: '只有名字' } })
    await expect(installExpertModule('https://example.test', live, 'u7-geo', nameless))
      .resolves.toEqual({ ok: false, message: '专家内容缺少名称或人设' })
    const rich: typeof fetch = async () => jsonResponse({
      success: true,
      data: {
        id: 'kept-id', name: '完整', description: '说明', persona: '人设', version: '3.0.0',
        skill_markdown: '正文', category: '!!!', subtitle: '副标题', icon: '🔍', tags: ['甲'], quick_prompts: ['先看'],
      },
    })
    await expect(installExpertModule('https://example.test', live, 'u7-rich', rich))
      .resolves.toEqual({ ok: true, slug: 'u7-rich', version: '3.0.0' })
    const sparse: typeof fetch = async () => jsonResponse({
      success: true,
      data: {
        id: '', name: '空 id', description: '说明', persona: '人设', version: '1.0.0',
        category: 4, skill_markdown: 1, subtitle: 1, icon: 1, tags: [1], quick_prompts: [1],
      },
    })
    await expect(installExpertModule('https://example.test', live, 'u7-sparse', sparse))
      .resolves.toEqual({ ok: true, slug: 'u7-sparse', version: '1.0.0' })
    const blocking = publisher(directory)
    blocking.hasId = async () => true
    const occupied: typeof fetch = async () => jsonResponse({
      success: true,
      data: { name: '占用', description: '说明', persona: '人设', version: '1.0.0' },
    })
    await expect(installExpertModule('https://example.test', blocking, 'u7-geo', occupied))
      .resolves.toEqual({ ok: false, message: 'id "u7-geo" is already on the roster' })
    const unnamed: typeof fetch = async () => jsonResponse({ success: true })
    await expect(publishExpertDocument('https://example.test', 'token', { ...document(), version: '1.0.0' }, unnamed))
      .resolves.toEqual({ ok: false, message: '上传没有返回专家 id' })
    const numeric: typeof fetch = async () => jsonResponse({ success: true, data: { slug: 1, version: '1.0.0' } })
    await expect(publishExpertDocument('https://example.test', 'token', { ...document(), version: '1.0.0' }, numeric))
      .resolves.toEqual({ ok: false, message: '上传没有返回专家 id' })
    const partial: typeof fetch = async () => jsonResponse({ success: true, data: { slug: 'u7-geo' } })
    await expect(publishExpertDocument('https://example.test', 'token', { ...document(), remoteSlug: 'u7-geo', version: '1' }, partial))
      .resolves.toEqual({ ok: false, message: '上传没有返回专家 id' })
    const bumped: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { version: string }
      if (body.version === '1.2.x') return jsonResponse({ success: false, message: '版本 1.2.x 已存在，请提升版本后再上传' })
      return jsonResponse({ success: true, data: { slug: 'u7-geo', version: body.version } })
    }
    await expect(publishExpertDocument('https://example.test', 'token', { ...document(), version: '1.2.x' }, bumped))
      .resolves.toEqual({ ok: true, slug: 'u7-geo', version: '1.2.1' })
  })

  it('lists plaza cards and the versions saved on this machine', async () => {
    const directory = await root()
    const live = publisher(directory)
    await publishExpert(live, { ...DRAFT, version: '1.0.0' })
    await publishExpert(live, { ...DRAFT, id: 'other-expert', name: '另一个', version: '2.0.0', remoteSlug: 'remote-other' })
    await publishExpert(live, { ...DRAFT, id: 'plain-expert', name: '无版本' })
    const versions = await installedExpertVersions(directory)
    expect(versions.get('geo-prelaunch')).toBe('1.0.0')
    expect(versions.get('remote-other')).toBe('2.0.0')
    expect(versions.has('plain-expert')).toBe(false)

    const failed: typeof fetch = async () => { throw new Error('offline') }
    await expect(fetchExpertPlaza('https://example.test', failed)).resolves.toEqual({ ok: false, message: 'offline' })
    const thrown: typeof fetch = async () => { throw 'offline' }
    await expect(fetchExpertPlaza('https://example.test', thrown)).resolves.toEqual({ ok: false, message: 'offline' })
    const text: typeof fetch = async () => new Response('nope', { status: 502 })
    await expect(fetchExpertPlaza('https://example.test', text)).resolves.toEqual({ ok: false, message: '专家广场没有返回 JSON' })
    const bare: typeof fetch = async () => jsonResponse({ success: false })
    await expect(fetchExpertPlaza('https://example.test', bare)).resolves.toEqual({ ok: false, message: '专家广场请求失败 (200)' })
    const empty: typeof fetch = async () => jsonResponse({ success: true, data: {} })
    await expect(fetchExpertPlaza('https://example.test', empty)).resolves.toEqual({ ok: true, cards: [] })
    const listed: typeof fetch = async () => jsonResponse({
      success: true,
      data: {
        items: [
          { id: 'kept', name: '保留', version: '1.0.0', description: '说明', category: 'marketing', tags: ['GEO'], author: '作者' },
          { id: 'named', name: '对象', version: '1.0.0', description: '', category: '', tags: 'no', author: { name: '甲' } },
          { id: 'quiet', name: '安静', version: '1.0.0', author: { name: '' }, tags: [1] },
          { id: 'blank-author', name: '空作者', version: '1.0.0', author: '' },
          { id: 'num-author', name: '数字作者', version: '1.0.0', author: 1 },
          { id: '', name: '空', version: '1.0.0' },
          { id: 1, name: '数字', version: '1.0.0' },
          { id: 'noname', name: 1, version: '1.0.0' },
          { id: 'noversion', name: '无', version: 1 },
          'skip',
        ],
      },
    })
    await expect(fetchExpertPlaza('https://example.test', listed)).resolves.toEqual({
      ok: true,
      cards: [
        { slug: 'kept', name: '保留', version: '1.0.0', description: '说明', category: 'marketing', tags: ['GEO'], author: '作者' },
        { slug: 'named', name: '对象', version: '1.0.0', author: '甲' },
        { slug: 'quiet', name: '安静', version: '1.0.0' },
        { slug: 'blank-author', name: '空作者', version: '1.0.0' },
        { slug: 'num-author', name: '数字作者', version: '1.0.0' },
      ],
    })
  })

  it('pairs a plaza install with a newer published version and keeps an upload local', () => {
    expect(versionRows(
      [
        { id: 'mine', version: '1.0.0', remoteSlug: 'u1-mine', origin: 'mine' },
        { id: 'u7-geo', version: '1.0.0', remoteSlug: 'u7-geo', origin: 'plaza' },
        { id: 'plain', origin: 'mine' },
      ],
      new Map([['u1-mine', '2.0.0'], ['u7-geo', '1.1.0']]),
      new Map([['geo-optimizer', '1.0.1'], ['u7-geo', '9.0.0']]),
    )).toEqual([
      { id: 'mine', version: '1.0.0' },
      { id: 'u7-geo', version: '1.0.0', remoteVersion: '1.1.0' },
      { id: 'geo-optimizer', version: '1.0.1' },
    ])
  })
})

function document() {
  return {
    id: 'geo-optimizer',
    name: 'GEO 优化专家',
    description: '诊断可见度。',
    persona: '你是顾问。',
    skillMarkdown: '',
    category: 'marketing',
    subtitle: '官方',
    icon: '🔍',
    tags: ['GEO'],
    quickPrompts: ['先诊断'],
  }
}
