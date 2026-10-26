import type { ReactNode } from 'react'
import {
  IconApiOutline14, IconBrowseOutline16, IconCodeOutline16, IconEditOutline16, IconSearchOutline16, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallOwnerProps, ToolTreeProps } from '../../contract/slots.ts'
import { imageCardModel } from '../models/image-card-model.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { searchCardModel } from '../models/search-card-model.ts'
import { terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { toolRowModel, type ToolRowVariant } from '../models/tool-call-model.ts'
import { localizeAutoReviewDenial } from '../models/auto-review-denial.ts'
import { ToolRow } from '../components/ToolRow.tsx'

/** Variant leading icons (figma table); all glyphs render at 14 inside the 16px leading box. */
const VARIANT_ICONS: Record<ToolRowVariant, ReactNode> = {
  search: <IconSearchOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  bash: <IconApiOutline14 size={14} />,
  write: <IconEditOutline16 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  others: <IconSparkle16 size={14} />,
}

/** Card props: the owner payload, the gallery dispatcher, and the locale seat (plain prop). */
export interface GenericToolCardProps extends ToolCallOwnerProps {
  t: ToolTreeProps['t']
  /**
   * Dispatch the generic row's image gallery through `tool.call.result-images`,
   * the child slot this row's entry declares. Absent when the row is rendered
   * outside that entry (the auto-review denial path), which leaves the card text.
   */
  renderSlot?: PropsRenderSlots<'tool.call.result-images'>['renderSlot'] | undefined
}

export function GenericToolCard({
  toolName, block, cwd, home, openFile, inspect, loadImage, renderSlot, t,
}: GenericToolCardProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const autoReview = model.autoReviewDenial === null
    ? null
    : localizeAutoReviewDenial(model.autoReviewDenial, t)
  const terminal = terminalCardModel(block, cwd)
  const read = readCardModel(block, cwd, home)
  const diff = diffCardModel(block)
  const search = searchCardModel(block)
  const web = webCardModel(block)
  // A tool without a keyed view that returns images still shows them: the result's
  // own blocks are the evidence, so a generated material is visible here rather
  // than only named by the paths in its text.
  const image = imageCardModel(block, cwd, home)
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  const singleFile = model.filePath !== undefined
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={VARIANT_ICONS[model.variant]}
      title={t(model.titleKey)}
      summary={model.summary}
      // Single-file tools never expose an args body — the path link is the only
      // args interaction. A card is not an args body: a read/write/edit row is
      // single-file AND carries a card, so the card expands under the path link.
      bodyRaw={singleFile || autoReview !== null ? null : model.bodyRaw}
      output={autoReview?.output ?? model.output}
      errorSummary={autoReview?.summary ?? model.errorSummary}
      terminal={terminal}
      diff={diff}
      read={read}
      image={image}
      renderImages={renderSlot === undefined
        ? undefined
        : (images, load) => renderSlot('tool.call.result-images', { images, loadImage: load, align: 'start' })}
      loadImage={loadImage}
      search={search}
      web={web}
      state={state}
      filePath={model.filePath}
      onOpenFile={singleFile ? openFile : undefined}
      inspect={inspect}
    />
  )
}
