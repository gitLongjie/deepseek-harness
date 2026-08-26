// 深度Works brand wordmark — the mark plus the product name. The name rides
// real text instead of raster lettering, so rebrands never need new art.

import { MewoLogo } from './MewoLogo.tsx'
import type { IconProps } from './icons/props.ts'

/** Display options for the official brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading mark.
 * @returns the wordmark (aria-hidden decorative brand art with live text).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(2, Math.round(size / 4)) }}
    >
      {includeMark && <MewoLogo size={size} />}
      <span style={{ fontSize: size, lineHeight: `${size}px`, fontWeight: 600 }}>深度Works</span>
    </span>
  )
}
