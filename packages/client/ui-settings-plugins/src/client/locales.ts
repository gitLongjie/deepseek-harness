/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'
  | 'subagentModelSelectionTitle' | 'subagentModelSelectionDescription'
  | 'subagentModelSelectionToggle' | 'subagentModelSelectionChoose' | 'subagentModelSelectionAllowed'
  | 'subagentModelSelectionLoading' | 'subagentModelSelectionLoadFailed' | 'subagentModelSelectionRetry'
  | 'subagentModelSelectionPartial' | 'subagentModelSelectionUnavailable'
  | 'subagentModelSelectionUnavailableGroup' | 'subagentModelSelectionEmpty'
  | 'subagentModelSelectionRequired' | 'subagentModelSelectionConflict' | 'subagentModelSelectionOff'
  | 'h3Title' | 'h3Description'
  | 'h3MinimaxApiKey' | 'h3MinimaxApiKeyHint' | 'h3MinimaxApiKeySet' | 'h3MinimaxApiKeyUnset'
  | 'h3ComfyUrl' | 'h3ComfyUrlHint'
  | 'h3ComfyWorkflowPath' | 'h3ComfyWorkflowPathHint'
  | 'h3ComfyInputDir' | 'h3ComfyInputDirHint'
  | 'h3ComfyResolutions' | 'h3ComfyResolutionsHint'
  | 'h3ComfyMaxConcurrency' | 'h3ComfyMaxConcurrencyHint'
  | 'h3ComfyMinDuration' | 'h3ComfyMinDurationHint'
  | 'h3ComfyMaxDuration' | 'h3ComfyMaxDurationHint'
  | 'h3ComfyPollInterval' | 'h3ComfyPollIntervalHint'
  | 'h3ComfyTaskTimeout' | 'h3ComfyTaskTimeoutHint'
  | 'h3MinimaxApiKeyRef' | 'h3MinimaxApiKeyRefHint'
  | 'h3MinimaxBaseUrl' | 'h3MinimaxBaseUrlHint'
  | 'h3MinimaxModel' | 'h3MinimaxModelHint'
  | 'h3MinimaxMaxConcurrency' | 'h3MinimaxMaxConcurrencyHint'
  | 'h3MinimaxPollInterval' | 'h3MinimaxPollIntervalHint'
  | 'h3MinimaxTaskTimeout' | 'h3MinimaxTaskTimeoutHint'
  | 'h3OutputDir' | 'h3OutputDirHint'
  | 'h3MinFreeSpaceMb' | 'h3MinFreeSpaceMbHint'
  | 'h3EstimatedBytesPerSecond' | 'h3EstimatedBytesPerSecondHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The DeepSeek search provider.',
  webSearchApiKey: 'API key',
  webSearchApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  webSearchApiKeySet: 'A key is configured.',
  webSearchApiKeyUnset: 'No key is configured; search is unavailable until one is.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'Leave blank to use the provider default.',
  webSearchMaxUses: 'Max searches per request',
  webSearchMaxUsesHint: 'How many times one request may search before it must answer.',
  subagentModelSelectionTitle: 'Subagent',
  subagentModelSelectionDescription: 'Control which models agents may choose for subagents.',
  subagentModelSelectionToggle: 'Allow agents to choose models for subagents',
  subagentModelSelectionChoose: 'When enabled, agents can choose a provider, model, and reasoning effort for each subagent from the authorized models below. Applies only to new sessions.',
  subagentModelSelectionAllowed: 'Models agents may choose',
  subagentModelSelectionLoading: 'Loading models…',
  subagentModelSelectionLoadFailed: 'Models could not be loaded.',
  subagentModelSelectionRetry: 'Retry',
  subagentModelSelectionPartial: 'Some model providers could not be loaded; saved choices remain removable.',
  subagentModelSelectionUnavailable: 'Currently unavailable',
  subagentModelSelectionUnavailableGroup: 'Saved but currently unavailable',
  subagentModelSelectionEmpty: 'No model provider currently advertises a model.',
  subagentModelSelectionRequired: 'Select at least one model before saving.',
  subagentModelSelectionConflict: 'Settings changed elsewhere. Discard your draft and try again.',
  subagentModelSelectionOff: 'Subagents use configured defaults or inherit the parent agent\'s model. Saved model choices are retained.',
  h3Title: 'Video generation (H3)',
  h3Description: 'Local ComfyUI, the hosted MiniMax API, and output policy. Blank fields keep the preset composition\'s values.',
  h3MinimaxApiKey: 'API key',
  h3MinimaxApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  h3MinimaxApiKeySet: 'A key is configured.',
  h3MinimaxApiKeyUnset: 'No key is configured.',
  h3ComfyUrl: 'ComfyUI URL',
  h3ComfyUrlHint: 'The local ComfyUI origin, for example http://127.0.0.1:8188.',
  h3ComfyWorkflowPath: 'Workflow template',
  h3ComfyWorkflowPathHint: 'Path to the API-format workflow JSON with "{{field}}" placeholders. Setting one enables the local backend.',
  h3ComfyInputDir: 'Input directory',
  h3ComfyInputDirHint: 'ComfyUI input directory; required for image-to-video with keyframes.',
  h3ComfyResolutions: 'Resolutions',
  h3ComfyResolutionsHint: 'Comma-separated tiers the local backend serves, for example 768P, 2K.',
  h3ComfyMaxConcurrency: 'Concurrent generations',
  h3ComfyMaxConcurrencyHint: 'How many local generations may run at once.',
  h3ComfyMinDuration: 'Minimum seconds',
  h3ComfyMinDurationHint: 'Shortest segment the local backend accepts.',
  h3ComfyMaxDuration: 'Maximum seconds',
  h3ComfyMaxDurationHint: 'Longest segment the local backend accepts.',
  h3ComfyPollInterval: 'Poll interval (ms)',
  h3ComfyPollIntervalHint: 'Milliseconds between ComfyUI history polls.',
  h3ComfyTaskTimeout: 'Task timeout (ms)',
  h3ComfyTaskTimeoutHint: 'Wall-clock bound on one local generation.',
  h3MinimaxApiKeyRef: 'API key reference',
  h3MinimaxApiKeyRefHint: 'Credential reference resolving the hosted key, for example MINIMAX_API_KEY. Setting one enables the remote backend.',
  h3MinimaxBaseUrl: 'Base URL',
  h3MinimaxBaseUrlHint: 'The hosted MiniMax API origin.',
  h3MinimaxModel: 'Model',
  h3MinimaxModelHint: 'MiniMax-H3 or MiniMax-H3-Max.',
  h3MinimaxMaxConcurrency: 'Concurrent generations',
  h3MinimaxMaxConcurrencyHint: 'How many remote generations may run at once.',
  h3MinimaxPollInterval: 'Poll interval (ms)',
  h3MinimaxPollIntervalHint: 'Milliseconds between remote task polls.',
  h3MinimaxTaskTimeout: 'Task timeout (ms)',
  h3MinimaxTaskTimeoutHint: 'Wall-clock bound on one remote generation.',
  h3OutputDir: 'Output directory',
  h3OutputDirHint: 'Where segments and assemblies land; supports ~. Blank uses the preset composition\'s directory.',
  h3MinFreeSpaceMb: 'Free-space floor (MB)',
  h3MinFreeSpaceMbHint: 'Free megabytes the output volume must keep beyond the size estimate.',
  h3EstimatedBytesPerSecond: 'Bytes per second',
  h3EstimatedBytesPerSecondHint: 'Size estimate per second of video for the disk preflight (768P ≈ 500000).',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '插件',
  title: '插件',
  intro: '配置和查看本部署已安装的插件。',
  tabs: '插件视图',
  configurableTab: '插件配置',
  empty: '本部署没有开放任何插件设置。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  bashTitle: '终端',
  bashDescription: '限制 agent 运行的每一条命令。',
  bashTimeoutMs: '命令超时（毫秒）',
  bashTimeoutMsHint: '单条命令允许运行多久，超时即终止。',
  bashMaxOutputBytes: '单流输出上限（字节）',
  bashMaxOutputBytesHint: '超出部分会转存到临时文件，而不是被丢弃。',
  agentLoopTitle: 'Agent 循环',
  agentLoopDescription: 'Agent 如何派发工具调用。',
  agentLoopMaxParallel: '并行工具调用数',
  agentLoopMaxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  webSearchTitle: '网页搜索',
  webSearchDescription: 'DeepSeek 搜索提供方。',
  webSearchApiKey: 'API Key',
  webSearchApiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  webSearchApiKeySet: '已配置密钥。',
  webSearchApiKeyUnset: '未配置密钥；配置之前搜索不可用。',
  webSearchBaseUrl: '接口地址',
  webSearchBaseUrlHint: '留空则使用提供方默认地址。',
  webSearchMaxUses: '单次请求最多搜索次数',
  webSearchMaxUsesHint: '一次请求在必须作答前最多可以搜索多少次。',
  subagentModelSelectionTitle: 'Subagent',
  subagentModelSelectionDescription: '控制 Agent 为 Subagent 选择模型的权限。',
  subagentModelSelectionToggle: '允许 Agent 为 Subagent 选择模型',
  subagentModelSelectionChoose: '开启后，Agent 可以从下方授权模型中，为每个 Subagent 选择提供方、模型和推理强度。仅影响新会话。',
  subagentModelSelectionAllowed: 'Agent 可选择的模型',
  subagentModelSelectionLoading: '正在加载模型…',
  subagentModelSelectionLoadFailed: '无法加载模型。',
  subagentModelSelectionRetry: '重试',
  subagentModelSelectionPartial: '部分模型提供方暂时无法加载；已保存的选择仍可移除。',
  subagentModelSelectionUnavailable: '当前不可用',
  subagentModelSelectionUnavailableGroup: '已保存但当前不可用',
  subagentModelSelectionEmpty: '当前没有模型提供方公布模型。',
  subagentModelSelectionRequired: '保存前请至少选择一个模型。',
  subagentModelSelectionConflict: '设置已在其他位置更新。请放弃修改后重试。',
  subagentModelSelectionOff: '关闭后，Subagent 使用配置的默认模型或继承父 Agent 的模型；已选模型会保留。',
  h3Title: '视频生成（H3）',
  h3Description: '本地 ComfyUI、远端 MiniMax API 与输出策略。留空的字段沿用预设组合里的值。',
  h3MinimaxApiKey: 'API 密钥',
  h3MinimaxApiKeyHint: '不写入设置文件。留空表示保持现有密钥。',
  h3MinimaxApiKeySet: '已配置密钥。',
  h3MinimaxApiKeyUnset: '未配置密钥。',
  h3ComfyUrl: 'ComfyUI 地址',
  h3ComfyUrlHint: '本地 ComfyUI 地址，例如 http://127.0.0.1:8188。',
  h3ComfyWorkflowPath: '工作流模板',
  h3ComfyWorkflowPathHint: '带 "{{field}}" 占位符的 API 格式工作流 JSON 路径。设置后即启用本地后端。',
  h3ComfyInputDir: '输入目录',
  h3ComfyInputDirHint: 'ComfyUI 的 input 目录；图生视频（首末帧）时必填。',
  h3ComfyResolutions: '分辨率',
  h3ComfyResolutionsHint: '本地后端支持的档位，逗号分隔，例如 768P, 2K。',
  h3ComfyMaxConcurrency: '并发生成数',
  h3ComfyMaxConcurrencyHint: '本地同时进行的生成任务数。',
  h3ComfyMinDuration: '最短秒数',
  h3ComfyMinDurationHint: '本地后端接受的最短分镜时长。',
  h3ComfyMaxDuration: '最长秒数',
  h3ComfyMaxDurationHint: '本地后端接受的最长分镜时长。',
  h3ComfyPollInterval: '轮询间隔（毫秒）',
  h3ComfyPollIntervalHint: '两次 ComfyUI 历史轮询之间的毫秒数。',
  h3ComfyTaskTimeout: '任务超时（毫秒）',
  h3ComfyTaskTimeoutHint: '单个本地生成的墙钟上限。',
  h3MinimaxApiKeyRef: '密钥引用',
  h3MinimaxApiKeyRefHint: '解析远端密钥的凭据引用，例如 MINIMAX_API_KEY。设置后即启用远端后端。',
  h3MinimaxBaseUrl: '接口地址',
  h3MinimaxBaseUrlHint: 'MiniMax 托管 API 的地址。',
  h3MinimaxModel: '模型',
  h3MinimaxModelHint: 'MiniMax-H3 或 MiniMax-H3-Max。',
  h3MinimaxMaxConcurrency: '并发生成数',
  h3MinimaxMaxConcurrencyHint: '远端同时进行的生成任务数。',
  h3MinimaxPollInterval: '轮询间隔（毫秒）',
  h3MinimaxPollIntervalHint: '两次远端任务轮询之间的毫秒数。',
  h3MinimaxTaskTimeout: '任务超时（毫秒）',
  h3MinimaxTaskTimeoutHint: '单个远端生成的墙钟上限。',
  h3OutputDir: '输出目录',
  h3OutputDirHint: '分镜与成片的落盘位置；支持 ~。留空沿用预设组合的目录。',
  h3MinFreeSpaceMb: '剩余空间下限（MB）',
  h3MinFreeSpaceMbHint: '除估算体积外，输出卷必须保留的剩余兆字节数。',
  h3EstimatedBytesPerSecond: '每秒字节数',
  h3EstimatedBytesPerSecondHint: '磁盘预检按每秒视频的体积估算（768P 约 500000）。',
}
