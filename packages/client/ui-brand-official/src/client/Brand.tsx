import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * The hero and sidebar mark seats share one presentation shape (square edge
 * plus host class). Declared structurally here so this package stays a leaf:
 * importing the conversation face would drag its whole client program into
 * this package's compilation.
 */
type OfficialBrandMarkProps = {
  /** Requested square edge in pixels. */
  size: number
  /** Host class preserving the surrounding mark geometry. */
  className?: string | undefined
} & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official MEWO mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  const src = process.env.DSH_CLIENT_BRAND_ICON ?? '/favicon.svg'
  return <img src={src} width={size} height={size} className={className} alt="" />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  const name = process.env.DSH_CLIENT_BRAND_NAME ?? '深度Work'
  return <span>{name}</span>
}
