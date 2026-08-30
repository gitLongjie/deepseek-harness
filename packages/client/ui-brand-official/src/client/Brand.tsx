import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

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
  const name = process.env.DSH_CLIENT_BRAND_NAME ?? '深度Works'
  return <span>{name}</span>
}
