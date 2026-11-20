/**
 * Publish a hireable expert into the running roster from the conversation.
 *
 * A share message (a WorkBuddy launch link, or 「创建了一个专家「名称」」)
 * gets an instruction to call `publish_expert` before the turn ends. The tool
 * writes the expert under the harness home and registers it immediately, so
 * the expert page lists it without a process restart. A turn that matches and
 * never calls the tool still publishes a short card from the share text.
 * @module @deepseek-ai/dsh-expert-publish
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { boundContextSummary, createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadPublishedExperts, publishExpert, resolveExpertRoot, type ExpertDraft, type ExpertPublisher } from './publish.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live publisher for experts saved under the harness home. */
    expertPublisher: ExpertPublisher
  }
}
import { expertIdForName, fallbackPersona, fallbackShare, parseExpertShare, PUBLISH_TOOL, publishNotice, textOf } from './share.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Instruction to publish a shared expert before the turn ends. */
    'expert-publish': { kind: 'expert-publish' } & ContextFormed
  }
}

export const name = 'expert-publish'
export const inject = ['tools', 'agentPresets']

/** Directory override. Omitted, experts persist under the harness home. */
export interface Config {
  /** Absolute directory of published experts. */
  root?: string
}

/** Schemastery configuration. `root` is optional; the home directory is the default. */
export const Config: z<Config> = z.object({
  root: z.string(),
})

const TOOL_DESCRIPTION = 'Publish or replace one hireable expert in the running expert list. '
  + 'Call it before the turn ends when the user shares an expert (a WorkBuddy launch link, or a message that says they created an expert in 「」) '
  + 'or asks to add an expert to the expert list. Pass the id from the turn instruction when one is present. '
  + 'The card is usable immediately; do not edit repository presets and do not ask for an application restart. '
  + 'Republishing the same id replaces that expert.'

/**
 * Register the tool, restore experts saved earlier, and watch share turns.
 * @param ctx - host context. The tool is global, so every agent can call it.
 * @param config - optional directory override.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const owned = new Map<string, () => Promise<void>>()
  const publisher: ExpertPublisher = {
    root: resolveExpertRoot(config.root, dshHomePath('published-experts')),
    owned,
    register: definition => ctx.agentPresets.register(definition),
    hasId: async id => (await ctx.agentPresets.list()).some(row => row.id === id),
  }
  ctx.provide('expertPublisher', publisher)
  ctx.effect(() => async () => {
    const disposers = [...owned.values()]
    owned.clear()
    for (const dispose of disposers) await dispose()
  }, 'expert-publish: registrations')
  await loadPublishedExperts(publisher)

  ctx.tools.register(defineTool({
    name: PUBLISH_TOOL,
    description: TOOL_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: 'Lowercase slug. Use the id from the turn instruction when it names one.' },
      name: { type: 'string', required: true, description: 'Card title.' },
      description: { type: 'string', required: true, description: 'One-line card description.' },
      persona: { type: 'string', required: true, description: 'System prompt for sessions hired as this expert.' },
      category: { type: 'string', description: 'Category slug. Defaults to marketing.' },
      subtitle: { type: 'string', description: 'Card subtitle. Defaults to 我的专家.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Card tags.' },
      quickPrompts: { type: 'array', items: { type: 'string' }, description: 'Suggested first messages.' },
      icon: { type: 'string', description: 'Card glyph.' },
      skillMarkdown: { type: 'string', description: 'Skill body the expert loads. A full SKILL.md starting with --- is stored as written.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          replaced: { type: 'boolean', required: true },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `${value.replaced ? 'Replaced' : 'Published'} expert "${value.name}" (${value.id}). It is in the expert list now. Hire it into a new chat; this chat keeps its current composition.`
          : value.reason ?? 'The expert was not published.',
      }],
    },
    execute(args) {
      const draft: ExpertDraft = {
        id: args.id,
        name: args.name,
        description: args.description,
        persona: args.persona,
        ...args.category === undefined ? {} : { category: args.category },
        ...args.subtitle === undefined ? {} : { subtitle: args.subtitle },
        ...args.tags === undefined ? {} : { tags: args.tags },
        ...args.quickPrompts === undefined ? {} : { quickPrompts: args.quickPrompts },
        ...args.icon === undefined ? {} : { icon: args.icon },
        ...args.skillMarkdown === undefined ? {} : { skillMarkdown: args.skillMarkdown },
      }
      return publishExpert(publisher, draft)
    },
  }))

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    if (decision.messages.some(message => message.source.kind === 'expert-publish')) return decision
    const share = payload.messages
      .filter(message => message.source.kind === 'user')
      .map(message => parseExpertShare(textOf(message)))
      .findLast(parsed => parsed !== undefined)
    if (share === undefined) return decision
    const notice = createUserMessage({
      content: [{ type: 'text', text: publishNotice(share) }],
      source: { kind: 'expert-publish', form: 'notice', summary: boundContextSummary(`Add expert ${share.name}`) },
    })
    return { ...decision, messages: [...decision.messages, notice] }
  })

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const share = fallbackShare(session.snapshotEvents(), event.data.turn)
    if (share === undefined) return
    const id = expertIdForName(share.name)
    if (owned.has(id)) return
    void publishExpert(publisher, {
      id,
      name: share.name,
      description: share.description,
      persona: fallbackPersona(share),
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`expert-publish: ${message}`)
    })
  })
}
