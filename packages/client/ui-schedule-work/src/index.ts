/**
 * Scheduled-work plugin, node half. The empty apply keeps the browser entry
 * addressable from the Loader composition. The browser entry registers
 * dictionaries only; Automation tasks owns the sidebar scheduling entry.
 */

/** Host plugin body — the browser entry registers dictionaries and no page. */
export function apply(): void {}
