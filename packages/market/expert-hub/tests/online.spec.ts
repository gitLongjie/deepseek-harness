import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishExpert, type ExpertPublisher } from '@deepseek-ai/dsh-expert-publish/src/publish.ts'
import { installExpertModule, publishLocalExpert, uploadableExpertIds } from '../src/online.ts'

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
})
