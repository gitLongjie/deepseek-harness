---
description: "面向模型的 MiniMax H3 视频工具：分镜规划、后台片段渲染，以及基于 ctx.h3Video 服务的 ffmpeg 拼接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-video

[English](README.md) | 中文

## 概述

本包注册三个面向模型的工具——`video_plan`、`video_render` 与 `video_assemble`——把一次对话变成分镜、用 MiniMax H3 在后台渲染镜头、再把完成的片段拼接成单个 mp4。它是 [`@deepseek-ai/dsh-h3-video`](../h3-video/README.zh.md) 服务接口的消费者。当模型应在单一对话中驱动"描述 → 分镜 → 渲染 → 拼接"、且同时使用本地 ComfyUI 与托管 API 后端时选择它。

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

在 `@deepseek-ai/dsh-h3-video` 之上加载本包，同时需要后台任务运行时（基础组合已包含 `@deepseek-ai/dsh-jobs-local` 与 `@deepseek-ai/dsh-tool-jobs`）。三个工具对每个 agent 可用。

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

- **`video_plan(goal, segments, mode?, assets?, style?)`**——把对话需求结构化为带版本的分镜并持久化为 JSON 工件。传入已有 `plan_id` 则修订并递增版本。片段带有 id、镜头 prompt、可选运镜、时长、分辨率、比例、每段的 `local`/`remote`/`auto` 路由选择，以及可选 `references`（参考素材：图片作为 `first_frame`/`last_frame`/`reference_image`，视频作为 `reference_video`，音频作为 `reference_audio`，每个都是绝对路径或 http(s) URL）。引用角色会按其类型校验。`assets` 声明分镜引用的可复用角色/场景/道具锚点；`style` 是一行视觉风格指令。`mode` 默认为 `multi_shot`：整份分镜合成一条 H3 任务（总时长 ≤15 秒、统一分辨率/比例），镜头之间风格连贯；`per_segment` 则每段独立渲染再拼接，用于需要各自素材或后端的镜头。
- **`video_assets(plan_id, assets, style?)`**——在询问用户素材后，记录可复用的素材锚点及其用户提供的参考图。每个素材引用必须是绝对路径或 http(s) URL。这些锚点会作为渲染的条件，保证角色/场景/道具跨镜头一致。
- **`video_asset_images(plan_id, asset_ids?)`**——为没有参考图的素材生成参考图，按生产规范分类型：角色生成"正脸特写+三视图"设定参考图、场景生成无人物可复用的空镜建立镜头、道具生成中性参考图。每张落在 `outputDir/assets/<planId>-<assetId>.png` 并记录到计划；结果同时携带图片本身与路径，因此生成的素材在对话里直接可见，而不只是一个路径。
- **`video_keyframes(plan_id, segment_ids?)`**——为每个选中镜头生成一张关键帧图片（托管 image 模型），在生成视频前先定场景与视觉。关键帧落在 `outputDir/keyframes/<planId>-<segmentId>.png`，应展示给用户确认；结果携带图片本身，确认环节看到的是画面而不是路径。没有关键帧的镜头按文生视频渲染。
- **`video_render(plan_id, segment_ids?, backend?)`**——提交到路由后的后端并启动一个轮询到完成的后台任务。`multi_shot` 模式一个任务渲染整份分镜（`all` 片段 id）；`per_segment` 模式每个选中片段各一个任务。锚定遵循 H3 的条件规则：首尾帧条件（`first_frame`/`last_frame`）与参考条件互斥，因此镜头一旦带任何参考素材（计划的素材锚点或手写 reference 输入）就统一走 full-reference（关键帧或手写帧输入降级为 `reference_image`，保留全部锚点而不是丢弃一部分），prompt 追加一行 `References: <Picture N> …` 契约，按内容顺序标注每个素材；图片条件本地经 ComfyUI `MiniMaxH3ReferenceToVideo` 节点服务。只有关键帧的镜头按首帧图生视频渲染；两者都没有则保持文生视频。返回带 job id 的提交记录；结果通过标准任务通知与 `job_output` 到达。视频/音频引用仍需远端 API（本地工作流只服务图片条件）。
- **`video_assemble(plan_id, output_file?, ffmpeg_path?)`**——产出成片：`multi_shot` 直接返回单条已渲染片段（无需拼接）；`per_segment` 用 ffmpeg 按分镜顺序拼接。per-segment 默认输出为 `<outputDir>/final/<planId>.mp4`（DSH cache 目录）；传入 `output_file` 可把成品放到别处（如 workspace），并在其上调用 `present` 让用户收到成片。若某片段尚未渲染则失败并列出缺失项。

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

- **服务拥有生成，工具拥有工作流。** 所有后端逻辑都在 `h3-video` 中；本包只负责结构化计划、启动任务与拼接。
- **长任务是后台任务。** 每段渲染都作为 `h3-video` 类任务运行（`JobKindMap` 通过声明合并扩展），因此工具立即返回 job id，而不是阻塞模型回合。
- **处处使用规范 JSON。** 每个工具声明完整的结果 schema 并以紧凑 JSON 渲染，编译器据此检查 `execute` 与对模型的承诺一致。
- **确定性片段路径。** 成功的渲染把 provider 产物移动到 `outputDir/segments/<planId>-<segmentId>.mp4`，这正是 `video_assemble` 按计划顺序读取的路径。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口与三个工具注册 |
| [`src/types.ts`](src/types.ts) | `VideoSegment`、`VideoPlan`、`RenderSubmission`，以及 `h3-video` 任务类扩展 |

不发布运行时 invariant 伴生包：计划文件与任务记录分别由 fs 层与任务注册表拥有，而非本包。

### 计划存储

计划是 `<outputDir>/plans/<planId>.json` 下的 JSON 工件，以原子方式写入（临时文件 + 改名）。计划内容也原样出现在 `video_plan` 结果中，因此即便计划不是会话事件，回放也能重建模型所见的全部内容。计划 id 按会话单调分配（`vp-1`、`vp-2`、……）。

### 任务生命周期

`video_render` 同步提交每段（很快——只是入队任务），然后注册一个 `h3-video` 任务，其 producer 把 provider 轮询到终态。取消会中止轮询信号并尽力取消后端任务。在任务启动前失败的提交会就地报告、不带 job id；不会静默留下孤儿。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [h3-video 包](../h3-video/README.zh.md)——本工具背后的 `ctx.h3Video` 服务接口。
- [生成的工具目录](../../../docs/tool-catalog.zh.md)——模型收到的每个工具 schema。
- [通用长任务运行时 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.zh.md)——后台任务 producer 契约。

-----

<a id="model-experience"></a>
## 模型体验

### 模型面向契约

#### 模型看到什么

三个工具都以紧凑 JSON 返回。渲染工具返回带 job id 的提交记录与一行摘要；任务通过标准任务管线投递各自的完成通知。失败是命名片段或后端的可读原因，绝不含原始堆栈。工具不携带每次调用的隐藏状态：计划按 id 从磁盘重新读取，因此一个回合创建的计划在下一回合可用。

#### Token 影响

每次工具调用只把紧凑 JSON 结果写入历史；渲染与轮询输出从不流入模型上下文。渲染任务输出由 `outputLimitBytes`（每任务 4 KB）限定。

#### KV Cache 影响

本包不添加系统提示文本，因此不会扰动 LLM provider 的可复用请求前缀。工具调用与结果照常在其后追加。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **没有会话日志计划投影。** 计划以文件存储（见[理解实现](#understand-the-implementation)）；一等公民的投影留待会话格式工作。
- **拼接是重编码而非流拷贝。** `video_assemble` 用 libx264 重编码以保证一致性；纯 CPU 主机上超长影片需要数分钟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

工具测试驱动真实工具注册表，`jobs` 与 `h3Video` 为桩、`Session` 为真实实现；`video_render` 的任务 producer 通过桩的 `start` 捕获被验证。`h3-video` 任务类在 `src/types.ts` 中声明，使 `JobKind` 联合保持可合并扩展。

</details>
