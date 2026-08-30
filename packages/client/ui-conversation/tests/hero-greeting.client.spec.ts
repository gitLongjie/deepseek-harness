import { describe, expect, it } from 'vitest'
import { heroGreetingKey, heroGreetingSlot } from '../src/client/skeleton/hero-greeting.ts'
import { configuredGreetingCopy } from '../src/client/oem-greetings.ts'
import { en, zh } from '../src/client/locales.ts'

/** Local-clock Date at the given hour; the minute and date carry no meaning. */
function atHour(hour: number): Date {
  return new Date(2026, 7, 30, hour, 0)
}

describe('hero greeting slot', () => {
  it('buckets every local hour into the five slots', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const expected = hour < 5 || hour >= 23 ? 'night'
        : hour < 11 ? 'morning'
          : hour < 14 ? 'noon'
            : hour < 18 ? 'afternoon'
              : 'evening'
      expect(heroGreetingSlot(atHour(hour))).toBe(expected)
    }
  })

  it('starts each slot at its inclusive boundary hour', () => {
    expect(heroGreetingSlot(atHour(4))).toBe('night')
    expect(heroGreetingSlot(atHour(5))).toBe('morning')
    expect(heroGreetingSlot(atHour(11))).toBe('noon')
    expect(heroGreetingSlot(atHour(14))).toBe('afternoon')
    expect(heroGreetingSlot(atHour(18))).toBe('evening')
    expect(heroGreetingSlot(atHour(23))).toBe('night')
  })

  it('keys the greeting into the conversation hero namespace', () => {
    expect(heroGreetingKey(atHour(9))).toBe('hero.greeting.morning')
    expect(heroGreetingKey(atHour(23))).toBe('hero.greeting.night')
  })

  it('falls back to the system clock when no instant is given', () => {
    expect(['night', 'morning', 'noon', 'afternoon', 'evening']).toContain(heroGreetingSlot())
    expect(['night', 'morning', 'noon', 'afternoon', 'evening']).toContain(
      heroGreetingKey().replace('hero.greeting.', ''),
    )
  })
})

describe('OEM hero greeting copy', () => {
  it('replaces only the five configured greeting keys in both locale dictionaries', () => {
    const customZh = {
      morning: '甲', noon: '乙', afternoon: '丙', evening: '丁', night: '戊',
    }
    const customEn = {
      morning: 'A', noon: 'B', afternoon: 'C', evening: 'D', night: 'E',
    }
    const copy = configuredGreetingCopy(
      zh,
      en,
      JSON.stringify(customZh),
      JSON.stringify(customEn),
    )
    expect(copy.zh['hero.greeting.night']).toBe('戊')
    expect(copy.en['hero.greeting.afternoon']).toBe('C')
    expect(copy.zh['hero.chooseWorkspace']).toBe(zh['hero.chooseWorkspace'])
  })

  it('fails loud when an injected greeting dictionary is malformed', () => {
    expect(() => configuredGreetingCopy(zh, en, '{"morning":"only"}', undefined))
      .toThrow(/DSH_CLIENT_GREETINGS_ZH/)
  })
})
