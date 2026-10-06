# Agent Note: H3 视频生成工具

Status: implemented

[English](2026-09-29-h3-video-generation-tools.md) | 中文

## Problem

DeepSeek Harness 此前无法从对话中生成视频。MiniMax H3 开源了可在本地通过 ComfyUI 运行的权重，也提供托管 V2 API，但两个入口都无法从 agent 会话触达，本地 GPU 后端与托管 API 之间也没有任何路由接口。

## Decision

由两个 experimental 包承载该能力。

`@deepseek-ai/dsh-experimental-h3-video` 是能力接口：一个 `H3Video` 服务定义，包含三个角色。Provider 为 `createComfyUIProvider`（本地队列、模板填充、`/prompt` + `/history` 轮询、`/view` 下载、`/interrupt` 取消）与 `createMiniMaxApiProvider`（托管 V2 建任务、任务轮询、限时 URL 下载）。每个 provider 拥有自己的传输与文件下载；两者都不拥有重试策略或路由。路由是唯一的显式函数 `resolve`，按段选择 `local` / `remote` / `auto`，并总是在提交前用所选后端声明的能力校验请求。`assembleVideo` 用 ffmpeg 把有序片段文件拼接为统一的 h264/yuv420p/24fps mp4。所有可调项都是经过校验的 `Config` 字段。

`@deepseek-ai/dsh-experimental-tool-video` 是消费者：`ctx.h3Video` 之上的三个模型面向工具。`video_plan` 把对话需求结构化为带版本的分镜，并以 JSON 工件持久化到输出目录；`video_render` 把每个选中片段提交到路由后的后端，并为每段启动一个 `h3-video` 类后台任务轮询到完成；`video_assemble` 按计划顺序读取确定性的 `segments/<planId>-<segmentId>.mp4` 文件并拼接。`h3-video` 任务类通过声明合并扩展 `JobKindMap`。

计划以文件存储，而非会话事件。`video/plan` 事件需要持久化目录与会话格式版本机制；取而代之，计划内容原样出现在 `video_plan` 工具结果中，会话回放可以重建模型所见的全部内容，工件本身位于 `outputDir/plans/` 下。

下载默认落在 DSH cache `video` 目录（`$DSH_HOME/cache/video`，经 `@deepseek-ai/dsh-home-paths` 解析）；每次提交都会对输出卷预检：剩余空间低于配置的 `minFreeSpaceMb` 下限加上 `estimatedBytesPerSecond` × 时长时拒绝生成，每次写文件前再查一次，遇到 `ENOSPC` 返回明确的磁盘已满原因。MiniMax API key 通过配置的 `apiKeyRef` 在每次请求时经 `ctx.credentials` 解析，密钥只存在于受管凭据存储，绝不写入组合文件。

工具之外还有一个人工入口：`tool-video` 包同时注册 `/video <描述>` 斜杠指令，入队一个用户回合并携带描述及 拆分镜→渲染→拼接→交付 的步骤说明，模型据此驱动同一套管线，无需用户手打完整请求。指令与工具一同挂载（专家 preset 中），通过 `agent.followup` 注入 `source.kind: 'user'` 的 `createUserMessage`，会唤醒空闲的 driver。

流程是先确认再生成：`video_plan` 可携带每段的 `references`（图片作为首帧/尾帧或参考图，视频作为 `reference_video`，音频作为 `reference_audio`，每个都是绝对路径或 http(s) URL，角色按其类型校验）；专家 persona 与 `/video` 消息指示模型把分镜——场景、提示词、时长、路由与素材问题——呈现给用户并获批后再 `video_render`。远端 API 按秒计费，因此本地失败必须向用户说明，远端使用必须显式获批，而不能通过 `auto` 路由静默回退。

计划以两种模式渲染。`multi_shot`（默认）把整份分镜合成一条 H3 任务，prompt 携带带时间码的镜头时间线（`[0s-6s] Shot 1: …`），总时长 ≤15 秒且统一分辨率/比例，因此各镜头共享风格、主体与光照，不会像多次独立生成那样互相不搭；渲染任务写出 `segments/<planId>-all.mp4`，拼接阶段直接返回该文件。`per_segment` 则每段独立任务再拼接，用于需要各自参考素材或后端的镜头。原先总是逐段渲染的做法会产出明显不一致的多镜头片段，正是这次拆出模式的原因。

流程是"素材优先、先定视觉、再生成"，而不是一上来就文生视频：`video_plan` 声明分镜引用的可复用素材锚点（角色/场景/道具）；`video_assets` 在模型向用户要素材后记录用户提供的参考图（对齐参考短剧生产管线：角色有设定参考图、场景有空镜锚点、道具有参考图）；`video_asset_images` 在用户没图时通过托管 `image-01` 模型按各类型生产规范生成参考图（角色三视图、无人空镜、中性道具图），落到 `outputDir/assets/<planId>-<assetId>.png`；`video_keyframes` 为每个镜头生成一张关键帧（本地 ComfyUI 部署没有 H3 文生图节点），保存到 `outputDir/keyframes/<planId>-<segmentId>.png`。专家 persona 指示模型在 `video_render` 前把素材、关键帧连同分镜展示给用户确认。渲染时以计划的素材参考图做 reference 锚定，存在关键帧时再作为视频首帧——图生视频与 reference 锚定既走远端 API（本地路径以 base64 data URI 发送），也走本地 ComfyUI 模板：provider 把图片复制进 `comfy.inputDir`，关键帧经 `LoadImage` 节点连到 H3 节点的帧输入，参考图则把 H3 节点换成 `MiniMaxH3ReferenceToVideo` 并填它的 `ref_images` autogrow 输入——从而用已确认的视觉在本地驱动视频。首帧请求按 H3 内容规则强制 `ratio: adaptive`，comfyui 能力也改为声明多模态支持。

## Testing

Provider 测试基于 mock HTTP 服务器，覆盖提交、轮询、下载、失败原因、超时、取消与能力声明。工具测试驱动真实工具注册表，`jobs` 与 `h3Video` 为桩、`Session` 为真实实现；另有 loader 组合测试通过真实 Loader 启动 cordis.yml 并搭配 mock ComfyUI HTTP 服务器。手动 E2E 冒烟脚本（`packages/experimental/h3-video/scripts/e2e-smoke.mts`）用 text2img checkpoint 驱动真实 ComfyUI 服务器，完成提交 → 轮询 → 下载 → ffmpeg 拼接，产出有效的 4 秒 h264 文件。

## Alternatives considered

- **带 `ignorable` 标记的 `video/plan` 会话日志事件。** 否决：`Session.append` 对非 surface 事件不提供 `ignorable` 选项，而新增已知事件类型需要重新生成持久化目录并触碰会话格式版本机制——对 experimental 特性来说代价过大。文件化计划在无格式机制的前提下保住了模型可见契约（计划在工具结果中）。
- **单一巨石包。** 否决：能力接口规则要求 Service Definition / Provider / Consumer 三角色分离；`h3-video`（接口 + provider）与 `tool-video`（消费者）让各自的测试与依赖保持聚焦。
- **`video_plan` 内部调用 LLM 撰写镜头。** 否决：那会引入第二个模型可见的 LLM 请求及其会话日志负担。agent 已在回合中写出分镜；工具只负责校验与持久化。
- **远端优先，本地作为事后补充。** 否决：用户的部署是本地优先（RTX 3060），因此 `auto` 优先本地，在能力或可用性不满足时回退远端。

## Consequences

- 每段渲染都是后台任务：工具立即返回 job id，标准任务管线投递完成通知，长时本地生成不会阻塞模型回合。
- 路由失败在渲染时按段暴露，携带模型可读的原因，agent 无需猜测即可重排计划并重试。
- 计划不是一等公民的会话投影；回放仅在 `tool/result` 中可见。投影留待会话格式工作。
- 本地 provider 仅限文本 prompt；图像/视频/音频参考输入路由到托管 API。
- 该特性是 experimental：两个包均公开但无稳定性承诺，孵化期间 schema 可自由变更。
