/**
 * Recognize a shared-expert message and the stable id the roster uses for it.
 * @module @deepseek-ai/dsh-expert-publish/share
 */

import { createHash } from 'node:crypto'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'

/** Name and one-line job taken from a share message. */
export interface ParsedExpertShare {
  /** Display name, already trimmed. */
  readonly name: string
  /** Job summary, already trimmed and length-capped. */
  readonly description: string
}

/** Tool the model calls, and the call a turn-end fallback looks for. */
export const PUBLISH_TOOL = 'publish_expert'

const NAME_LIMIT = 80
const DESCRIPTION_LIMIT = 500
const LAUNCH_URL = /https?:\/\/(?:www\.)?workbuddy\.cn\/work\/launch\/\?\S+/i
const BRACKET_NAME = /创建了一个专家「([^」]{1,80})」/
const EXPERT_NAME_PARAM = /[?&]expertname=([^&\s]+)/i

/**
 * Stable roster id for one display name.
 *
 * The same name always maps to the same id, so a later publish replaces the
 * card instead of adding a second one.
 * @param name - display name.
 * @returns a lowercase id.
 */
export function expertIdForName(name: string): string {
  const digest = createHash('sha256').update(name.trim()).digest('hex').slice(0, 12)
  return `expert-${digest}`
}

/**
 * Read an expert share out of one user message.
 *
 * A match is either the sentence 「创建了一个专家「名称」」 or a WorkBuddy
 * launch URL. The description is the clause after the dash, when one is present.
 * @param text - the user message text.
 * @returns the name and description, or undefined when the text is not a share.
 */
export function parseExpertShare(text: string): ParsedExpertShare | undefined {
  const named = BRACKET_NAME.exec(text)
  const url = LAUNCH_URL.exec(text)
  if (named === null && url === null) return undefined
  const fromUrl = url === null ? undefined : expertNameParam(url[0])
  const name = cleanName(named?.[1] ?? fromUrl)
  if (name === undefined) return undefined
  return { name, description: descriptionAfter(text, name) }
}

/**
 * Instruction appended to the first step of a share turn.
 * @param share - the parsed share.
 * @returns the model-facing notice.
 */
export function publishNotice(share: ParsedExpertShare): string {
  const id = expertIdForName(share.name)
  return 'This user message shares an expert to add to the expert list. '
    + `Before this turn ends, call ${PUBLISH_TOOL} once with id "${id}", `
    + `name "${share.name}", and a description and persona that carry the expert's job. `
    + 'Include tags, quickPrompts, and skillMarkdown when you have them. '
    + 'Republishing the same id replaces the card. The card is hireable immediately. '
    + 'Do not edit repository preset files and do not ask the user to restart the application.'
}

/**
 * Persona used when the turn ends without a publish call.
 * @param share - the parsed share.
 * @returns a short system prompt.
 */
export function fallbackPersona(share: ParsedExpertShare): string {
  return `你是「${share.name}」。${share.description}\n\n`
    + '缺输入就停下来问，不要猜测补全。需要细则时加载 published-expert skill。'
}

/**
 * The share in one turn, unless that turn already called {@link PUBLISH_TOOL}.
 * @param events - the session log, including the closing turn/end when it has been appended.
 * @param turn - the turn that just ended.
 * @returns the last user-authored share in the turn, or undefined.
 */
export function fallbackShare(events: readonly SessionEvent[], turn: number): ParsedExpertShare | undefined {
  const slice = eventsOfTurn(events, turn)
  if (slice.some(event => event.type === 'tool/call' && event.data.name === PUBLISH_TOOL)) return undefined
  let found: ParsedExpertShare | undefined
  for (const event of slice) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const parsed = parseExpertShare(textOf(event.data))
    if (parsed !== undefined) found = parsed
  }
  return found
}

/**
 * Visible text of one user message. Non-text blocks are skipped.
 * @param message - the user message.
 * @returns the joined text blocks.
 */
export function textOf(message: UserMessage): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

function expertNameParam(url: string): string | undefined {
  const param = EXPERT_NAME_PARAM.exec(url)
  if (param === null) return undefined
  const raw = param[1]
  /* v8 ignore next -- the expertname pattern's capture is present whenever exec matches. */
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw.replaceAll('+', ' '))
  } catch (error) {
    // A malformed percent-escape is not an expert name. decodeURIComponent throws URIError for that.
    void error
    return undefined
  }
}

function cleanName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const name = value.trim()
  if (name === '' || name.length > NAME_LIMIT) return undefined
  return name
}

function descriptionAfter(text: string, name: string): string {
  const dash = text.search(/——|—/)
  if (dash < 0) return name
  const rest = text.slice(dash).replace(/^(?:——|—)/, '')
  const end = rest.search(/。|点击|https?:\/\//)
  const clause = (end >= 0 ? rest.slice(0, end) : rest).trim()
  if (clause === '') return name
  return clause.length <= DESCRIPTION_LIMIT ? clause : clause.slice(0, DESCRIPTION_LIMIT)
}

function eventsOfTurn(events: readonly SessionEvent[], turn: number): SessionEvent[] {
  let start = -1
  let end = events.length
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/start' && event.data.turn === turn) start = index
    if (event.type === 'turn/end' && event.data.turn === turn) end = index
  }
  if (start < 0) return []
  return events.slice(start + 1, end)
}
