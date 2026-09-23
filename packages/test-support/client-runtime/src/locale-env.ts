/**
 * Browser-language pin for specs that read `navigator` themselves. The
 * LocaleRuntime no longer consults the browser for its opening locale (the
 * product default stands until a stored preference lands), so this pin is
 * inert for locale selection; it stays for suites that assert
 * navigator-facing behavior or state the environment they assume.
 */
import { afterEach, beforeEach } from 'vitest'

/**
 * Pin `navigator.languages`/`navigator.language` for every test in the
 * calling file (or describe block), restoring the environment's own values
 * afterwards. Call at suite level, like the other vitest hooks.
 * @param primary - most preferred BCP 47 tag; also becomes `navigator.language`.
 * @param rest - further tags in preference order.
 */
export function usePinnedBrowserLanguages(primary: string, ...rest: string[]): void {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { value: [primary, ...rest], configurable: true })
    Object.defineProperty(navigator, 'language', { value: primary, configurable: true })
  })
  afterEach(() => {
    // Deleting the own properties uncovers the environment's own accessors
    // again (Navigator declares both readonly, hence the erased receiver).
    const own = navigator as unknown as Record<string, unknown>
    delete own.languages
    delete own.language
  })
}
