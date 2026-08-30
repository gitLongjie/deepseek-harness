import type { ConversationKey } from './locales.ts'

const SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const
type Dictionary = Readonly<Record<ConversationKey, string>>

/** Apply build-configured Hero greetings to the locale-owned dictionaries. */
export function configuredGreetingCopy(
  zh: Dictionary,
  en: Dictionary,
  encodedZh: string | undefined,
  encodedEn: string | undefined,
): { readonly zh: Dictionary; readonly en: Dictionary } {
  return {
    zh: applyGreetings(zh, encodedZh, 'DSH_CLIENT_GREETINGS_ZH'),
    en: applyGreetings(en, encodedEn, 'DSH_CLIENT_GREETINGS_EN'),
  }
}

function applyGreetings(dictionary: Dictionary, encoded: string | undefined, subject: string): Dictionary {
  if (encoded === undefined) return dictionary
  let value: unknown
  try {
    value = JSON.parse(encoded)
  } catch {
    throw new Error(`ui-conversation: ${subject} must be valid JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`ui-conversation: ${subject} must contain all five greeting strings`)
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== SLOTS.length
    || SLOTS.some(slot => typeof record[slot] !== 'string' || record[slot] === '')) {
    throw new Error(`ui-conversation: ${subject} must contain all five greeting strings`)
  }
  return {
    ...dictionary,
    ...Object.fromEntries(SLOTS.map(slot => [`hero.greeting.${slot}`, record[slot]])),
  }
}
