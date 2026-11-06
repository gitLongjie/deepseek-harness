/**
 * `generate_image` toolview: the generated picture belongs in the chat stream,
 * not behind a folded tool row. A settled success renders only the gallery
 * through `tool.call.images` (the same presentation as assistant message
 * images). Running and error states stay a single non-expandable status line.
 */
import type { Context } from '@deepseek-ai/cordis'
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { imageCardModel } from '../models/image-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './generate-image-row.module.css'

/** Props for the generate_image row: runtime share, image child slot, and locale. */
export type GenerateImageRowProps = ToolCallViewProps
  & PropsRenderSlots<'tool.call.images'>
  & { t: TranslateNS<'conversation'> }

/**
 * Render a generate_image call: the chat gallery when the result carries an
 * image, otherwise a one-line status with no disclosure chrome.
 * @param props - toolview runtime share and locale seat.
 * @returns the always-visible gallery or status line.
 */
export function GenerateImageRow({
  block, loadImage, renderSlot, t,
}: GenerateImageRowProps) {
  const image = imageCardModel(block)
  if (image !== null && loadImage !== undefined) {
    return (
      <div className={css.root} data-tool="generate_image" data-state="ok">
        {renderSlot('tool.call.images', {
          images: image.images,
          loadImage,
          align: 'start',
        })}
      </div>
    )
  }

  const model = toolRowModel('generate_image', block)
  const running = model.state === 'running' || model.state === 'preparing'
  const label = model.state === 'preparing'
    ? t('row.preparing')
    : running
      ? t('row.running')
      : model.errorSummary ?? model.output ?? t('tool.title.generateImage')
  return (
    <div
      className={css.status}
      data-tool="generate_image"
      data-state={model.state}
    >
      <span className={css.title}>{t('tool.title.generateImage')}</span>
      <span className={css.sep} aria-hidden />
      {running
        ? <TextShimmer className={css.summary} active>{label}</TextShimmer>
        : <span className={css.summary} data-error={model.state === 'error' || undefined}>{label}</span>}
    </div>
  )
}

/**
 * Register the generate_image row so its gallery is never gated on expand.
 * @param ctx - registrant context.
 */
export const generateImageToolview = {
  name: 'generate-image-toolview',
  inject: ['slots', 'sessions'],
  /**
   * Claim the `generate_image` keyed toolview and authorize its image slot.
   * @param ctx - registrant context.
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'generate_image',
        locale: NS,
        children: { 'tool.call.images': { kind: 'single', scope: 'session' } },
      }, GenerateImageRow))
  },
}
