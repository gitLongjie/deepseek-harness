/**
 * The hero headline follows the local time of day: five buckets pick one
 * greeting locale key, so the blank-session hero greets instead of carrying a
 * fixed marketing line. `getHours()` reads the OS-local clock, DST included.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/skeleton/hero-greeting
 */

/** One of the five time-of-day buckets the hero greeting distinguishes. */
export type HeroGreetingSlot = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'

/** Inclusive start hour of each bucket; the 00-05 hours keep the night greeting. */
const SLOT_START_HOURS: ReadonlyArray<readonly [number, HeroGreetingSlot]> = [
  [5, 'morning'],
  [11, 'noon'],
  [14, 'afternoon'],
  [18, 'evening'],
  [23, 'night'],
]

/**
 * Bucket the instant's local hour falls in.
 * @param now - the instant to bucket (defaults to the system clock).
 * @returns the greeting slot.
 */
export function heroGreetingSlot(now: Date = new Date()): HeroGreetingSlot {
  const hour = now.getHours()
  let slot: HeroGreetingSlot = 'night'
  for (const [start, candidate] of SLOT_START_HOURS) {
    if (hour >= start) slot = candidate
  }
  return slot
}

/**
 * Pick the hero greeting locale key for the instant's slot.
 * @param now - the instant to bucket (defaults to the system clock).
 * @returns a `hero.greeting.<slot>` dictionary key.
 */
export function heroGreetingKey(now: Date = new Date()): `hero.greeting.${HeroGreetingSlot}` {
  return `hero.greeting.${heroGreetingSlot(now)}`
}
