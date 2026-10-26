---
description: "面向模型的 MiniMax H3 视频工具：分镜规划、后台片段渲染，以及基于 ctx.h3Video 服务的 ffmpeg 拼接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-video

[English](README.md) | 中文

## 概述

本包注册八个面向模型的视频工具，负责分镜规划、素材与关键帧生成、后台渲染、云 GPU 管理，以及成片拼接。它是 [`@deepseek-ai/dsh-h3-video`](../h3-video/README.zh.md) 服务接口的消费者。当模型需要在一次对话中完成“描述 → 分镜 → 渲染 → 拼接”，并使用本地 ComfyUI（可选云 GPU）或托管 API 后端时选择它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@deepseek-ai/dsh-h3-video` 之上加载本包，同时需要后台任务运行时（基础组合已包含 `@deepseek-ai/dsh-jobs-local` 与 `@deepseek-ai/dsh-tool-jobs`）。八个工具对每个 agent 可用。

### 何时选择

当模型应不离开会话即可规划并渲染视频时选择它。当视频生成必须无头地在 agent 之外运行、或没有配置 H3 后端时不要使用（服务拒绝启动，工具在加载时响亮失败）。

### 最小可用示例

```yaml
- id: h3-video
  name: '@deepseek-ai/dsh-h3-video'
  config:
    comfy:
      url: 'http://127.0.0.1:8188'
      workflowPath: 'D:/ComfyUI/h3-workflow.json'

- id: tool-video
  name: '@deepseek-ai/dsh-tool-video'
```

本插件自身不声明任何配置；生成的[配置目录](../../../docs/config-catalog.zh.md#loadable-plugins-with-no-config)将其列于无配置的可加载插件清单。

### 模型能做什么

- **`video_plan(goal, segments, mode?, assets?, library_assets?, style?, seed?, allow_remote?)`**——保存和修订分镜。`mode` 默认 `multi_shot`：≤15 秒故事在一次 H3 任务中生成，统一后端、分辨率和比例。超过一镜时每镜必须记录 `start_state`、`event`、`end_state`，第二镜起填写 `continuity`；`asset_ids` 明确选择素材，空列表表示不使用素材。只接受第一镜的一张 image/first_frame，后续参考图和独立路由需改用 `per_segment`。省略 seed 时按计划派生；它仅帮助支持种子的服务重现采样，不能锁定角色或剧情。
- **`video_assets(plan_id, assets, style?)`**——在询问用户素材后记录可复用锚点、用户提供的参考图及可选的规范 `prompt` 块。素材引用必须是绝对本地路径或 http(s) URL。记录同时进入项目素材库，后续剧集可复用相同设定。
- **`video_asset_images(plan_id, asset_ids?, regenerate?, seed?)`**——为角色生成正面半身定妆照和文字驱动的正侧背设定表，为场景生成无人物建立图，为道具生成中性参考图。定妆照用于关键帧的主体参考；设定表是设计预览，没有以定妆照为条件，可能存在视觉差异。结果携带图片并保存到计划和项目素材库，`regenerate` 替换选中图片。
- **`video_keyframes(plan_id, segment_ids?, seed?)`**——在视频之前生成静帧。`multi_shot` 默认只生成第一镜的开场图，表现 `start_state` 且事件尚未发生；选中的后续静帧仅是分镜预览，不约束整片。展示图片供用户确认。本地图片工作流在收到主体参考时必须显式支持图生图。
- **`video_render(plan_id, segment_ids?, backend?, allow_remote?, chain?)`**——提交后台渲染。`multi_shot` 一次提交完整分镜，只使用第一镜手写的 first_frame 或生成的开场图；缺图时不提交，并拒绝 `segment_ids` 与 `chain=true`。`per_segment` 支持独立素材和可选串联；串联传递前段末帧，但不校验剧情。通过任务通知和 `job_output` 收集结果。远端计费仍要求 `allow_remote=true`，每项提交报告实际后端。
- **`video_assemble(plan_id, output_file?, ffmpeg_path?, transition?, transition_seconds?)`**——产出成片：`multi_shot` 原样返回 `segments/<planId>-all.mp4`，忽略输出与转场选项；`per_segment` 用 ffmpeg 按分镜顺序拼接。`transition="crossfade"` 为默认值：相邻画面与声音重叠淡化，`transition_seconds` 默认 0.4 秒，最大为任一相邻片段时长的一半，返回时长扣除重叠部分。`transition="cut"` 直接拼接；`transition="dip"` 淡出到黑再淡入，半段转场默认 0.25 秒。转场先统一画幅、帧率和音轨，无音轨时补静音，并按计划时长裁切或补足片段。处理失败会明确报告，不会退回硬切。转场拼接需要 ffmpeg 同目录或 PATH 中的 ffprobe。逐段模式默认输出 `<outputDir>/final/<planId>.mp4`；`output_file` 可指定其他位置（如 workspace），随后调用 `present` 交付成片。若片段尚未渲染，失败信息会列出缺失项。
- **`video_library()`**——列出项目素材库中保存的角色/场景/道具及其规范提示块、参考图和角色设定表。`video_plan library_assets` 可按名称引用。
- **`video_gpu(action)`**——管理本地后端使用的云 GPU：`status` 查询实例，`up` 启动或复用实例并等待 ComfyUI 就绪，`stop` 关机保留磁盘，`release` 删除实例。实例运行期间计费；本地渲染会隐式启动它，提前调用 `up` 可在提交渲染前暴露启动失败。

### 保持独立渲染镜头的视觉一致性

`per_segment` 为每个镜头单独提交任务，因此每次生成都需要携带视觉设定。以下六项机制应用于渲染：

- **锚点**：`asset_ids` 选择镜头使用的素材；省略时按提示词中的名字匹配。未点名任何素材时沿用场景和道具，不会自动带入角色。请求和提示词携带同一组素材描述。
- **固定提示块**：每个素材的规范 `prompt` 原样复制到定妆照、设定表、关键帧及视频片段中；未填写提示块时才使用简短的 `description`。只有修改该块才会改变描述，独立镜头因此使用相同措辞。
- **项目素材库**：记录保存在 `<outputDir>/assets/library.json`。后续计划通过 `library_assets` 引用并继承提示块、定妆照和设定表，无需每集重建角色。
- **风格**：计划的 `style` 追加到每次生成提示中，包括关键帧与素材图片。
- **关键帧**：静帧携带相同风格，镜头点名角色时以其定妆照作主体参考；视频随后从静帧生成，在采样动作之前固定面孔与服装。
- **种子**：计划保存一个种子并填入每次本地 ComfyUI 提交，重试与独立镜头使用相同随机输入。托管 H3 API 不提供 seed 参数并忽略该值。关键帧批次和素材图片可单独覆盖种子，以重现已接受设计或换种子生成新方案。

明确的素材 id、逐镜状态衔接、确认过的开场图和固定风格为 H3 提供一条完整时间线。程序只校验结构与 provider 限制，不能判断两段状态文字是否表达同一事实；真实生成仍需视觉审核。

预期流程是**素材优先**：先用 `video_plan` 起草分镜与素材清单（角色/场景/道具），【请用户提供参考图】并用 `video_assets` 记录（用户没图时用 `video_asset_images` 自动生成），再 `video_keyframes` 生成关键帧，把所有素材与分镜呈现给用户批准后渲染——远端后端按秒计费，未经用户明确同意绝不使用。用户也可以直接用 **`/video <描述>`** 斜杠指令唤起整条流程：它会入队一个用户回合，携带描述以及"要素材→确认→再渲染"的步骤说明。H3 音画同生（音频与画面同一次生成），因此镜头 prompt 应声明声音层：环境声与音效基线、中文对白逐字写进 `<d>[Chinese] 台词</d>`、不要配乐时显式写 `non_diegetic_music: N/A`（该层留空容易多出背景音乐）；`/video` 回合会把这条要求带给模型。

### 成功与失败形态

一次渲染提交要么携带 job id（`state: submitted`），要么携带模型可读的错误（`state: failed`，未启动任务）。任务在其输出中结算为 `[succeeded] s1 -> <file>` 或 `[failed] s1: <reason>`。当渲染任务尚未完成时，拼接会以精确的缺失片段 id 失败。路由失败（例如某段超出本地后端的时长上限）会在渲染时按段暴露，模型可据此重排计划并重试。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节说明工具背后的设计决策并指向实现代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

- **服务负责生成，工具负责工作流。** 所有后端逻辑（包括云 GPU 生命周期）位于 `h3-video`；本包负责结构化计划、启动任务与拼接。
- **长任务是后台任务。** 每段渲染都作为 `h3-video` 类任务运行（`JobKindMap` 通过声明合并扩展），因此工具立即返回 job id，而不是阻塞模型回合。
- **类型化结果。** 每个工具声明结果 schema，以紧凑 JSON 返回；图片生成工具同时附加图片内容供审核。
- **确定性片段路径。** 成功的渲染把 provider 产物移动到 `outputDir/segments/<planId>-<segmentId>.mp4`，这正是 `video_assemble` 按计划顺序读取的路径。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口与八个工具注册 |
| [`src/types.ts`](src/types.ts) | `VideoSegment`、`VideoPlan`、`RenderSubmission`，以及 `h3-video` 任务类扩展 |

不发布运行时 invariant 伴生包：计划文件与任务记录分别由 fs 层与任务注册表拥有，而非本包。

### 计划存储

计划是 `<outputDir>/plans/<planId>.json` 下的 JSON 工件，以原子方式写入（临时文件 + 改名）。计划内容也原样出现在 `video_plan` 结果中，因此即便计划不是会话事件，回放也能重建模型所见的全部内容。计划 id 按输出目录单调分配（`vp-1`、`vp-2`、……）：编号序列跟着它命名的产物走，新会话因此是接着排而不是复用 `vp-1` 覆盖上一个项目的计划、关键帧与成片。

### 任务生命周期

`video_render` 同步提交每段（很快——只是入队任务），然后注册一个 `h3-video` 任务，其 producer 把 provider 轮询到终态。取消会中止轮询信号并尽力取消后端任务。在任务启动前失败的提交会就地报告、不带 job id；不会静默留下孤儿。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

当包级说明不足时，可阅读以下页面。

- [h3-video 包](../h3-video/README.zh.md)——本工具背后的 `ctx.h3Video` 服务接口。
- [生成的工具目录](../../../docs/tool-catalog.zh.md)——模型收到的每个工具 schema。
- [通用长任务运行时 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.zh.md)——后台任务 producer 契约。

-----

<a id="model-experience"></a>
## 模型体验

### 模型面向契约

#### 模型看到什么

八个工具返回紧凑 JSON；素材图片与关键帧结果还携带图片。渲染工具返回带 job id 的提交记录和一行通知，任务通过标准任务管线投递完成通知。GPU 工具返回实例状态，并以一行通知说明服务 URL 与空闲窗口。失败信息是命名片段或后端的可读原因，不含原始堆栈。工具按 id 从磁盘重读计划，一个回合创建的计划可在下一回合使用。

#### Token 影响

每次工具调用将紧凑 JSON 结果及附加图片写入历史；渲染与轮询输出不流入模型上下文。渲染任务输出受 `outputLimitBytes`（每任务 4 KB）限制。

#### KV Cache 影响

本包不添加系统提示文本，因此不会扰动 LLM provider 的可复用请求前缀。工具调用与结果照常在其后追加。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **没有会话日志计划投影。** 计划以文件存储（见[理解实现](#understand-the-implementation)）；一等公民的投影留待会话格式工作。
- **逐段拼接会重编码。** `video_assemble` 使用 libx264 保持一致性，纯 CPU 主机处理超长影片需要数分钟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

工具测试驱动真实工具注册表，`jobs` 与 `h3Video` 为桩、`Session` 为真实实现；`video_render` 的任务 producer 通过桩的 `start` 捕获被验证。`h3-video` 任务类在 `src/types.ts` 中声明，使 `JobKind` 联合保持可合并扩展。

</details>
