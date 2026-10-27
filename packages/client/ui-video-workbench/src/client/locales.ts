/**
 * Video workbench copy. Locale-owned: every user-facing string lives here and
 * renders through `t`; the verify-client-ui-i18n gate rejects hardcoded copy.
 */

/** Locale keys the workbench surfaces render. */
export type VideoWorkbenchKey =
  | 'title'
  | 'refresh'
  | 'loading'
  | 'loadFailed'
  | 'empty'
  | 'emptyHint'
  | 'errors'
  | 'projectGoal'
  | 'projectMode.multi_shot'
  | 'projectMode.per_segment'
  | 'revision'
  | 'castTitle'
  | 'scenesTitle'
  | 'propsTitle'
  | 'assetsEmpty'
  | 'assetSheet'
  | 'assetSaved'
  | 'assetUnsaved'
  | 'assetPreview'
  | 'assetPreviewClose'
  | 'assetKind.character'
  | 'assetKind.scene'
  | 'assetKind.prop'
  | 'segments'
  | 'storyboard'
  | 'shotDuration'
  | 'storyboardRegenerate'
  | 'storyboardRegenerateRequest'
  | 'segmentRendered'
  | 'segmentPending'
  | 'segmentRegenerate'
  | 'segmentRegenerateHint'
  | 'segmentRegenerateFailed'
  | 'segmentRegenerateRequest'
  | 'segmentRegenerateAsset'
  | 'segmentRegenerateReference'
  | 'remove'
  | 'removeConfirm'
  | 'removeFailed'
  | 'assetRegenerate'
  | 'assetRegenerateRequest'
  | 'segmentAnchors'
  | 'finalTitle'
  | 'finalMissing'
  | 'keyframe'
  | 'planFile'
  | 'bytes.mb'

/** Dictionary namespace owned by this plugin. */
export const NS = 'videoWorkbench'

/** English copy. */
export const en = {
  title: 'Video workbench',
  refresh: 'Refresh',
  loading: 'Loading projects…',
  loadFailed: 'Could not load the video workbench listing.',
  empty: 'No video projects yet',
  emptyHint: 'Ask the agent to generate a video (or run /video) — finished plans appear here.',
  errors: 'Unreadable plans',
  projectGoal: 'Goal',
  'projectMode.multi_shot': 'one task',
  'projectMode.per_segment': 'per shot',
  revision: 'revision',
  castTitle: 'Cast',
  scenesTitle: 'Sets',
  propsTitle: 'Props',
  assetsEmpty: 'No cast or sets recorded for this plan',
  assetSheet: 'Legacy master sheet',
  assetSaved: 'In project library',
  assetUnsaved: 'Not in library',
  assetPreview: 'Open preview',
  assetPreviewClose: 'Close preview',
  'assetKind.character': 'Character',
  'assetKind.scene': 'Scene',
  'assetKind.prop': 'Prop',
  segments: 'Shots',
  storyboard: 'Storyboard',
  shotDuration: '{seconds}s',
  storyboardRegenerate: 'Regenerate storyboard',
  storyboardRegenerateRequest: 'Revise the storyboard of project {plan} using the text below. Keep its authored shot ids, durations, camera directions, style and asset references. Render the complete multi_shot plan as one task, then reassemble the film:\n\n{prompt}\n\nKeep using these asset anchors:\n{assets}',
  segmentRendered: 'rendered',
  segmentPending: 'not rendered',
  segmentRegenerate: 'Regenerate this shot',
  segmentRegenerateHint: 'Back in the chat — the prompt is prefilled in the input box. Edit it, then send.',
  segmentRegenerateFailed: 'Could not reach the chat input.',
  segmentRegenerateRequest: 'Replace the prompt of shot {segment} in project {plan} with the text below, redo only this shot, then reassemble the film:\n\n{prompt}\n\nThe anchors this shot renders against — keep using each asset\'s own reference images so the cast and sets stay consistent:\n{assets}',
  segmentRegenerateAsset: '- {name} ({kind}): {description} {references}',
  segmentRegenerateReference: '@"{path}"',
  remove: 'Delete',
  removeConfirm: 'Confirm delete',
  removeFailed: 'Delete failed: {reason}',
  assetRegenerate: 'Regenerate image',
  assetRegenerateRequest: 'Regenerate the image of asset "{name}" ({kind}) in project {plan}: call video_asset_images(plan_id="{plan}", asset_ids=["{assetId}"], regenerate=true) so the old reference is replaced, then report the new path.',
  segmentAnchors: 'anchors',
  finalTitle: 'Final assembly',
  finalMissing: 'not assembled yet',
  keyframe: 'keyframe',
  planFile: 'plan.json',
  'bytes.mb': 'MB',
} as const satisfies Record<VideoWorkbenchKey, string>

/** Chinese copy. */
export const zh: Record<VideoWorkbenchKey, string> = {
  title: '视频工作台',
  refresh: '刷新',
  loading: '正在加载项目…',
  loadFailed: '无法加载视频工作台列表。',
  empty: '还没有视频项目',
  emptyHint: '让助手生成视频（或使用 /video）——完成的分镜计划会出现在这里。',
  errors: '无法读取的计划',
  projectGoal: '目标',
  'projectMode.multi_shot': '单任务',
  'projectMode.per_segment': '逐镜头',
  revision: '版本',
  castTitle: '人物',
  scenesTitle: '场景',
  propsTitle: '道具',
  assetsEmpty: '该计划还没有记录素材',
  assetSheet: '旧版母图',
  assetSaved: '已入资产库',
  assetUnsaved: '未入资产库',
  assetPreview: '放大预览',
  assetPreviewClose: '关闭预览',
  'assetKind.character': '角色',
  'assetKind.scene': '场景',
  'assetKind.prop': '道具',
  segments: '镜头',
  storyboard: '分镜脚本',
  shotDuration: '{seconds}秒',
  storyboardRegenerate: '重新生成整段分镜',
  storyboardRegenerateRequest: '请根据以下内容修改项目 {plan} 的分镜脚本，保留原分镜编号、时长、运镜、风格和素材引用。将完整的 multi_shot 计划作为一个任务渲染，再合成成片：\n\n{prompt}\n\n继续使用以下素材锚点：\n{assets}',
  segmentRendered: '已渲染',
  segmentPending: '尚未渲染',
  segmentRegenerate: '重新生成这个镜头',
  segmentRegenerateHint: '已回到对话，提示词已填进输入框，改完发送即可。',
  segmentRegenerateFailed: '无法把提示词填进对话输入框。',
  segmentRegenerateRequest: '把项目 {plan} 中镜头 {segment} 的提示词改成下面这段，只重渲这一段，然后重新拼成片：\n\n{prompt}\n\n本镜头关联的素材（重渲时必须继续用每个素材自己的参考图，保持人物与场景一致）：\n{assets}',
  segmentRegenerateAsset: '- {name}（{kind}）：{description} {references}',
  segmentRegenerateReference: '@"{path}"',
  remove: '删除',
  removeConfirm: '确认删除',
  removeFailed: '删除失败：{reason}',
  assetRegenerate: '重新生成素材图',
  assetRegenerateRequest: '重新生成项目 {plan} 里素材「{name}」（{kind}）的参考图：调用 video_asset_images(plan_id="{plan}", asset_ids=["{assetId}"], regenerate=true) 出一版新的并替换旧图，然后告诉我新图路径。',
  segmentAnchors: '关联素材',
  finalTitle: '成片',
  finalMissing: '尚未拼接',
  keyframe: '关键帧',
  planFile: 'plan.json',
  'bytes.mb': 'MB',
}
