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
  | 'segments'
  | 'segmentRendered'
  | 'segmentPending'
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
  segments: 'Shots',
  segmentRendered: 'rendered',
  segmentPending: 'rendering…',
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
  segments: '镜头',
  segmentRendered: '已渲染',
  segmentPending: '渲染中…',
  finalTitle: '成片',
  finalMissing: '尚未拼接',
  keyframe: '关键帧',
  planFile: 'plan.json',
  'bytes.mb': 'MB',
}
