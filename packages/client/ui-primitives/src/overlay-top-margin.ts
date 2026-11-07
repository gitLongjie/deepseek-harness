/** Shared viewport inset for overlays, derived from the desktop frame's reserved top strip. */

/**
 * Read one length custom property from the document element.
 * @param root - the element that publishes frame insets.
 * @param name - the custom property, including the leading `--`.
 * @returns the parsed px value, or `NaN` when the property is unset.
 */
function readInset(root: HTMLElement, name: string): number {
  return Number.parseFloat(getComputedStyle(root).getPropertyValue(name))
}

/**
 * Resolve the top margin an overlay keeps from the viewport edge.
 * `--dsh-frame-top-clearance` wins when the frame publishes it (macOS
 * hiddenInset layout, Windows caption attribute). Otherwise the desktop
 * title bar's `--dsh-shell-top-inset` is the strip popups must clear.
 * @param min - the overlay's own viewport margin in px, used as the floor.
 * @param anchor - the overlay's anchor rect in viewport coordinates. While the anchor's top edge is inside the
 * viewport, the margin never exceeds `anchor.bottom + gap`, so an overlay opened from a control inside the top strip
 * stays next to it.
 * @param gap - the distance the overlay keeps below `anchor`.
 * @returns the published strip plus 20px (20px in fullscreen), capped by a visible `anchor`, but never below `min`.
 */
export function overlayTopMargin(min: number, anchor?: { readonly top: number; readonly bottom: number }, gap = 0): number {
  const root = document.documentElement
  const clearance = readInset(root, '--dsh-frame-top-clearance')
  const inset = Number.isNaN(clearance) ? readInset(root, '--dsh-shell-top-inset') : clearance
  if (Number.isNaN(inset)) return min
  const cap = anchor !== undefined && anchor.top >= 0 ? anchor.bottom + gap : Number.POSITIVE_INFINITY
  return Math.max(min, Math.min((root.hasAttribute('data-fullscreen') ? 0 : inset) + 20, cap))
}
