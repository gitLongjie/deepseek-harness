/**
 * Video workbench copy. Locale-owned: every user-facing string lives here and
 * renders through `t`; the verify-client-ui-i18n gate rejects hardcoded copy.
 */

/** Locale keys the workbench surfaces render. */
export type VideoWorkbenchKey =
  | 'script.list'
  | 'script.work'
  | 'script.new'
  | 'script.discard'
  | 'script.open'
  | 'script.busy'
  | 'script.save'
  | 'script.undo'
  | 'script.redo'
  | 'script.export'
  | 'script.saved'
  | 'script.failed'
  | 'script.conflict'
  | 'script.damaged'
  | 'script.dirty'
  | 'script.ready'
  | 'script.title'
  | 'script.source'
  | 'script.kind'
  | 'script.up'
  | 'script.down'
  | 'script.remove'
  | 'script.add'
  | 'script.kind.scene'
  | 'script.kind.action'
  | 'script.kind.character'
  | 'script.kind.dialogue'
  | 'script.kind.parenthetical'
  | 'script.kind.transition'
  | 'studio.load'
  | 'studio.open'
  | 'studio.saved'
  | 'studio.failed'
  | 'studio.conflict'
  | 'canvas.cardTitle'
  | 'canvas.cardText'
  | 'canvas.newCard'
  | 'canvas.add'
  | 'graph.node'
  | 'graph.newNode'
  | 'graph.addNode'
  | 'graph.edgeHint'
  | 'director.scene'
  | 'director.camera'
  | 'director.objects'
  | 'director.newScene'
  | 'director.addScene'
  | 'editor.clip'
  | 'editor.newTrack'
  | 'editor.addTrack'
  | 'canvas.zoom'
  | 'canvas.move'
  | 'graph.from'
  | 'graph.to'
  | 'graph.relationship'
  | 'graph.addEdge'
  | 'director.dataOnly'
  | 'director.object'
  | 'director.addObject'
  | 'editor.dataOnly'
  | 'editor.track'
  | 'editor.trackKind'
  | 'editor.kind.video'
  | 'editor.kind.dialogue'
  | 'editor.kind.sfx'
  | 'editor.kind.music'
  | 'editor.kind.subtitle'
  | 'editor.start'
  | 'editor.duration'
  | 'editor.addClip'
  | 'director.preview' | 'director.unavailable'
  | 'editor.export'
  | 'editor.download'
  | 'editor.source'
  | 'editor.sourceStart'
  | 'editor.volume'
  | 'script.exportFailed'
  | 'studioSkillRequest'
  | 'studio.useSkill'
  | 'studio.skillHint'
  | 'editor.chooseMedia'
  | 'studio.backup'
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
  | 'studioNav'
  | 'studioPreviewOnly'
  | `studio.${'overview' | 'screenplay' | 'canvas' | 'director' | 'editor' | 'graph' | 'skills'}`
  | 'screenplayHint' | 'cameraUnset' | 'directorSpace' | 'directorSpaceHint' | 'directorCamera' | 'directorCameraHint' | 'directorContinuity' | 'directorContinuityHint'
  | 'editorVideo' | 'editorVideoHint' | 'editorAudio' | 'editorAudioHint' | 'editorSubtitle' | 'editorSubtitleHint' | 'graphHint'
  | `skill.${'characterConsistency' | 'personaDesign' | 'goldenThree' | 'humanizeAi'}`
  | `skill.${'characterConsistency' | 'personaDesign' | 'goldenThree' | 'humanizeAi'}Hint`

/** Dictionary namespace owned by this plugin. */
export const NS = 'videoWorkbench'

/** English copy. */
export const en = {
  'studio.backup': 'Download work draft',
  'editor.chooseMedia': 'Choose generated media',
  'studioSkillRequest': 'Use the {skill} skill for production work {id}, revision {revision}. Read its current content with video_studio_read, review the requested creative aspect, and preserve unrelated content when saving through video_studio_save. Explain proposed substantive changes before applying them.',
  'studio.useSkill': 'Prepare skill request',
  'studio.skillHint': 'Save your work first. This action prepares a chat draft; review and send it to the video director agent.',

  'editor.export': 'Export saved movie',
  'editor.download': 'Download MP4',
  'editor.source': 'Media path relative to video output folder',
  'editor.sourceStart': 'Source in point (seconds)',
  'editor.volume': 'Volume multiplier',
  'script.exportFailed': 'Export failed. Check media paths, track types, source duration and FFmpeg installation; the work is saved.',

  'director.preview': '3D staging preview',
  'director.unavailable': '3D preview is unavailable. Your scene data is retained; check browser GPU support.',
  'canvas.zoom': 'Canvas zoom',
  'canvas.move': 'Move card',
  'graph.from': 'From node',
  'graph.to': 'To node',
  'graph.relationship': 'Relationship',
  'graph.addEdge': 'Add relationship',
  'director.dataOnly': 'Preview staging with proxy boxes. Camera coordinates and field of view are saved; the camera faces the scene origin.',
  'director.object': 'Scene object',
  'director.addObject': 'Add object',
  'editor.dataOnly': 'Save before exporting. Later video tracks cover earlier ones; audio tracks mix. Subtitle clip names become selectable MP4 captions.',
  'editor.track': 'Track name',
  'editor.trackKind': 'Track type',
  'editor.kind.video': 'Video',
  'editor.kind.dialogue': 'Dialogue',
  'editor.kind.sfx': 'Sound effects',
  'editor.kind.music': 'Music',
  'editor.kind.subtitle': 'Subtitles',
  'editor.start': 'Start (seconds)',
  'editor.duration': 'Duration (seconds)',
  'editor.addClip': 'Add clip',

  'studio.load': 'Load works',
  'studio.open': 'Open',
  'studio.saved': 'Saved',
  'studio.failed': 'Could not load work data.',
  'studio.conflict': 'This work changed elsewhere; reload before saving.',
  'canvas.cardTitle': 'Card title',
  'canvas.cardText': 'Card notes',
  'canvas.newCard': 'New scene',
  'canvas.add': 'Add card',
  'graph.node': 'Relationship node',
  'graph.newNode': 'New character',
  'graph.addNode': 'Add node',
  'graph.edgeHint': 'Add nodes first; relationship edges are preserved in the work document.',
  'director.scene': 'Scene name',
  'director.camera': 'Camera preset',
  'director.objects': 'Objects',
  'director.newScene': 'New scene',
  'director.addScene': 'Add scene',
  'editor.clip': 'Clip name',
  'editor.newTrack': 'Video track',
  'editor.addTrack': 'Add track',

  'script.list': 'Refresh works',
  'script.work': 'Work',
  'script.new': 'New work',
  'script.discard': 'Discard draft and open',
  'script.open': 'Open',
  'script.busy': 'Saving…',
  'script.save': 'Save',
  'script.undo': 'Undo',
  'script.redo': 'Redo',
  'script.export': 'Export Fountain',
  'script.saved': 'Revision saved.',
  'script.failed': 'Operation failed. Your draft is retained; retry when storage is available.',
  'script.conflict': 'Another editor saved a newer revision. Export your draft before reopening the work.',
  'script.damaged': 'Some works could not be read. Their files have been preserved.',
  'script.dirty': 'Unsaved changes',
  'script.ready': 'Ready to write',
  'script.title': 'Work title',
  'script.source': 'Original source',
  'script.kind': 'Element type',
  'script.up': 'Move up',
  'script.down': 'Move down',
  'script.remove': 'Remove element',
  'script.add': 'Add element',
  'script.kind.scene': 'Scene heading',
  'script.kind.action': 'Action',
  'script.kind.character': 'Character',
  'script.kind.dialogue': 'Dialogue',
  'script.kind.parenthetical': 'Parenthetical',
  'script.kind.transition': 'Transition',

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
  studioNav: 'Production studio',
  studioPreviewOnly: 'Planning preview only. Editing, 3D staging, timeline export and relationship editing are not implemented here.',
  'studio.overview': 'Overview', 'studio.screenplay': 'Screenplay', 'studio.canvas': 'Storyboard canvas', 'studio.director': '3D director', 'studio.editor': 'Edit timeline', 'studio.graph': 'Relationship graph', 'studio.skills': 'Creative skills',
  screenplayHint: 'Convert the selected story into scenes, actions, dialogue and transitions before laying out shots.',
  cameraUnset: 'Camera not set',
  directorSpace: 'Scene space', directorSpaceHint: 'Keep doors, paths, lighting and the axis consistent across shots.',
  directorCamera: 'Camera blocking', directorCameraHint: 'Preview shot positions and movement before rendering.',
  directorContinuity: 'Continuity check', directorContinuityHint: 'Every shot start state should reuse the previous shot end state.',
  editorVideo: 'Video track', editorVideoHint: 'Place rendered clips in story order and inspect the final assembly.',
  editorAudio: 'Dialogue and sound', editorAudioHint: 'Reserve dialogue, effects and music tracks for the finished cut.',
  editorSubtitle: 'Subtitle track', editorSubtitleHint: 'Keep captions aligned with the spoken language and shot timing.',
  graphHint: 'Project assets and render tasks. Relationship edges are not recorded in this view.',
  'skill.characterConsistency': 'Character consistency', 'skill.characterConsistencyHint': 'Keep face, clothing, props, hands and identity anchors stable across shots.',
  'skill.personaDesign': 'Persona design', 'skill.personaDesignHint': 'Turn a character brief into observable age, silhouette, styling and behavior anchors.',
  'skill.goldenThree': 'Golden three chapters', 'skill.goldenThreeHint': 'Build the opening hook, escalation and first payoff before expanding the story.',
  'skill.humanizeAi': 'Humanize AI prose', 'skill.humanizeAiHint': 'Remove generic phrasing, repeated structure and synthetic transitions while preserving intent.',
} as const satisfies Record<VideoWorkbenchKey, string>

/** Chinese copy. */
export const zh: Record<VideoWorkbenchKey, string> = {
  'studio.backup': '下载作品草稿',
  'editor.chooseMedia': '选择已生成的媒体',
  'studioSkillRequest': '请使用 {skill} 技能处理制片作品 {id}，当前版本 {revision}。先通过 video_studio_read 读取最新内容，审查相应创作问题；保存时使用 video_studio_save 并保留无关字段。实质改写前先说明调整建议。',
  'studio.useSkill': '准备技能请求',
  'studio.skillHint': '请先保存作品。此操作准备聊天草稿，由你检查后发送给视频导演智能体',

  'editor.export': '导出已保存的成片',
  'editor.download': '下载 MP4',
  'editor.source': '视频输出目录内的媒体相对路径',
  'editor.sourceStart': '源片入点（秒）',
  'editor.volume': '音量倍数',
  'script.exportFailed': '导出失败，请检查媒体路径、轨道类型、源片时长和 FFmpeg 安装；作品已保存',

  'director.preview': '3D 布景预览',
  'director.unavailable': '3D 预览不可用，场景数据已保留，请检查浏览器 GPU 支持',
  'canvas.zoom': '画布缩放',
  'canvas.move': '移动卡片',
  'graph.from': '起点节点',
  'graph.to': '终点节点',
  'graph.relationship': '关系名称',
  'graph.addEdge': '添加关系',
  'director.dataOnly': '用方块预演场景布置。相机坐标和视野角度随作品保存，相机朝向场景原点',
  'director.object': '场景物体',
  'director.addObject': '添加物体',
  'editor.dataOnly': '请先保存再导出。后面的视频轨覆盖前轨，音频轨混合，字幕片段名称导出为 MP4 可选字幕',
  'editor.track': '轨道名称',
  'editor.trackKind': '轨道类型',
  'editor.kind.video': '视频',
  'editor.kind.dialogue': '对白',
  'editor.kind.sfx': '音效',
  'editor.kind.music': '音乐',
  'editor.kind.subtitle': '字幕',
  'editor.start': '开始（秒）',
  'editor.duration': '时长（秒）',
  'editor.addClip': '添加片段',

  'studio.load': '加载作品',
  'studio.open': '打开',
  'studio.saved': '已保存',
  'studio.failed': '无法加载作品数据',
  'studio.conflict': '作品已被其他编辑器修改，请重新加载后保存',
  'canvas.cardTitle': '卡片标题',
  'canvas.cardText': '卡片备注',
  'canvas.newCard': '新场次',
  'canvas.add': '添加卡片',
  'graph.node': '关系节点',
  'graph.newNode': '新角色',
  'graph.addNode': '添加节点',
  'graph.edgeHint': '先添加节点；关系边会保存在作品文档中',
  'director.scene': '场景名称',
  'director.camera': '机位预设',
  'director.objects': '物体',
  'director.newScene': '新场景',
  'director.addScene': '添加场景',
  'editor.clip': '片段名称',
  'editor.newTrack': '视频轨',
  'editor.addTrack': '添加轨道',

  'script.list': '刷新作品',
  'script.work': '作品',
  'script.new': '新建作品',
  'script.discard': '放弃草稿并打开',
  'script.open': '打开',
  'script.busy': '处理中…',
  'script.save': '保存',
  'script.undo': '撤销',
  'script.redo': '重做',
  'script.export': '导出 Fountain',
  'script.saved': '版本已保存。',
  'script.failed': '操作失败，草稿已保留。请在存储恢复后重试。',
  'script.conflict': '其他编辑器已保存新版本。请先导出草稿，再重新打开作品。',
  'script.damaged': '部分作品无法读取，其文件已保留。',
  'script.dirty': '尚未保存',
  'script.ready': '开始创作',
  'script.title': '作品名称',
  'script.source': '原文对照',
  'script.kind': '段落类型',
  'script.up': '上移',
  'script.down': '下移',
  'script.remove': '删除段落',
  'script.add': '添加段落',
  'script.kind.scene': '场景标题',
  'script.kind.action': '动作',
  'script.kind.character': '角色',
  'script.kind.dialogue': '对白',
  'script.kind.parenthetical': '表演提示',
  'script.kind.transition': '转场',

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
  studioNav: '制片工作台',
  studioPreviewOnly: '当前仅为规划预览；此处尚未实现编辑保存、3D 布景、时间线导出和关系编辑',
  'studio.overview': '总览', 'studio.screenplay': '剧本编辑器', 'studio.canvas': '无限画布', 'studio.director': '3D 导演台', 'studio.editor': '剪辑台', 'studio.graph': '关系图谱', 'studio.skills': '创作技能',
  screenplayHint: '先把原著或故事整理成场次、动作、对白和转场，再铺开分镜。',
  cameraUnset: '尚未设置机位',
  directorSpace: '场景空间', directorSpaceHint: '保持门窗、通道、光源和轴线在连续镜头中一致。',
  directorCamera: '机位调度', directorCameraHint: '渲染前预览机位位置、视线和运动路线。',
  directorContinuity: '连续性检查', directorContinuityHint: '每一镜的开始状态应复用上一镜的结束状态。',
  editorVideo: '视频主轨', editorVideoHint: '按故事顺序排列已渲染片段，并检查最终成片。',
  editorAudio: '对白与声音', editorAudioHint: '为对白、音效和配乐预留独立轨道。',
  editorSubtitle: '字幕轨', editorSubtitleHint: '让字幕语言和出现时间与对白保持一致。',
  graphHint: '这里只列出项目素材和渲染任务，尚未记录关系连线',
  'skill.characterConsistency': '角色一致性', 'skill.characterConsistencyHint': '保持脸型、服装、道具、左右手和身份锚点在镜头间稳定。',
  'skill.personaDesign': '人设设计', 'skill.personaDesignHint': '把角色简介转成可观察的年龄、轮廓、造型和行为锚点。',
  'skill.goldenThree': '黄金三章', 'skill.goldenThreeHint': '先完成开篇钩子、升级冲突和第一次兑现，再扩展完整故事。',
  'skill.humanizeAi': '去 AI 味', 'skill.humanizeAiHint': '保留原意，减少套话、重复句式和机械转折，让文本更像真实作者。',
}
