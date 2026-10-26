# Agent Note: 对齐 oh-story-dsh 的 H3 视频实践

Status: implemented

[English](2026-10-06-h3-video-oh-story-alignment.md) | 中文

## Problem

社区的 [oh-story-dsh](https://github.com/zenstory-ai/oh-story-dsh) 短剧工作台同样以 MiniMax H3 生成视频，其 adapter（`short-drama-produce/references/providers/minimax-h3-video.md` + `provider_adapters.py`）公布了一批我们的 h3-video/tool-video 没有跟上的事实：

- **能力档位属于部署配置。** 账号开通哪个 release、它接受什么分辨率/时长，每个 release 各不相同——oh-story 的 adapter 对模型 id 故意不设默认，resolutions/durations 一律显式配置。我们却把 `model` 限制成 `MiniMax-H3`/`MiniMax-H3-Max` 枚举，并按模型名硬编码 capabilities：未来 release 一出现就要改代码，自定义端点的账号直接配不了。
- **协议约束我们只实现了一半。** 首尾帧各最多一张、引用计数上限（9 图/3 视频/3 音频）、`mm_file://{file_id}` 引用、内联 base64 的单模态上限（30/50/15 MB）与整个请求体 64 MB 上限——这些已发布规则我们均未校验，超限请求会发给 provider 才被打回，模型拿到的是不归因的错误。
- **frame 与 reference 互斥时我们的组装会静默丢锚点。** `tool-video` 在镜头同时有 keyframe（first_frame）和素材锚点时直接不加 reference——用户挂上的角色/场景参考图被丢弃且无提示，违反"never silently skip a missing referent"。
- **多模态引用需要 prompt 内标签。** oh-story 的 compiler 给每个引用素材附加 `<Picture N>`/`<Video N>`/`<Audio N>` 标注；MiniMax 的 full-reference 语义靠这些标签把 prompt 与 content 数组对应。我们发引用素材不带任何标注。
- **H3 音画同生。** oh-story 的方言文档（`short-drama-video-prompts/references/minimax-h3.md`）记录了实测结论：声音层留空易出多余配乐，`non_diegetic_music: N/A` 要显式写；中文对白逐字进 `<d>[Chinese] 台词</d>`。我们的 `/video` 流程与工具描述完全没有声音层指导。

## Decision

- **能力档位配置化**（h3-video）：`minimax.model` 放宽为任意 release id；新增 `minimax.resolutions`/`minDurationSeconds`/`maxDurationSeconds` 显式覆盖档位。已知 id（H3、H3-Max）保留已发布档位为内置值；没有内置档位的 id 缺显式配置时构造即失败（fail loud，不猜测）。设置卡（`ui-settings-plugins`）同步暴露三个新字段并映射进 overlay。
- **协议校验补齐**（h3-video）：`validateSegmentRequest` 增加首尾帧唯一与 9/3/3 计数上限；`toApiUrl` 透传 `mm_file://`、按模态拒绝超限本地文件；`toBody` 在 base64 展开后拒绝超 64 MB 的请求体，错误消息给出 https URL 的替代路径。
- **full-reference 统一**（tool-video）：`withKeyframe` + `withAssetReferences` 合并为 `buildSegmentRequest`。镜头一旦带任何参考素材（手写 reference 或素材锚点），全部统一为 reference_image 条件——keyframe/手写首帧降级而非丢弃锚点——并按 content 顺序在 prompt 尾部附加 `References: <Picture 1> opening keyframe; <Picture 2> 小明 (character)` 契约行；只有 keyframe 时维持 first_frame 图生视频。降级后 ratio 保留原值（full-reference 下 adaptive 合法）。
- **音画同生指导**（tool-video）：`/video` 回合提示与 `video_plan` 的 prompt 参数描述加入声音层要求（环境声/音效、`<d>[Chinese] 台词</d>`、`non_diegetic_music: N/A`），与 oh-story 的 dialect 结论一致；措辞留在模型指令层，不进 adapter 生成的样板文。

## Alternatives considered

- **照搬 oh-story 的六段方言模板（subject_definitions/retention_analysis 等）。** 拒绝：那是其短剧 Skill 的 prompt 工程，依赖分镜文档里的"用途/控制"槽位；我们的 plan schema 没有这些作者概念，塞进工具层是样板文而不是配置。
- **frame+reference 并存时报错拒绝。** 拒绝：两个都是用户明确提供的东西；oh-story 的判定表就是把这种组统一进 full-reference，降级保留全部锚点比报错更符合"素材优先"流程。
- **对引用视频/音频做 2–15 秒时长校验。** 不做：需要 ffprobe 探测，oh-story 同样不测（文档明确让配置自行约束）；计数与体积上限已挡住最坏的滥用。
- **默认 baseUrl 改成 oh-story 的 `https://api.minimax.io/v2`。** 不改：我们的用户群在 `api.minimax.cn`，且 baseUrl 本就是可配置字段。

## Consequences

- 未知 MiniMax release id（如 H3.5、账号专属端点）从设置卡即可接入，无需发版；代价是配错档位时错误出现在服务构建（load 或 overlay 重建），消息里明确指出要补哪些字段。
- keyframe + 素材锚点并存的镜头现在发送 reference 条件而非 frame 条件：开场构图约束变弱，换来素材一致性不被丢弃；`routing` 的校验保证两种条件永不混发，本地 ComfyUI 的 frame+ref 混合拒绝路径因此不可达（防御保留）。
- prompt 尾部多出的契约行会进入模型可见的请求与回放（`toSegmentRequest` 产物即提交内容），快照无影响（tool-video 无 keyless 快照覆盖该路径）。
- 后续若接 Seedance 通道（oh-story 同样公布了其 adapter 契约），`PUBLISHED_ENVELOPES` + 显式档位的结构可以直接复用：新 provider 行只需自己的 envelope 表与端点。

## References

- oh-story-dsh 的 MiniMax H3 adapter 参考：`packages/knowledge/drama/skills/short-drama-produce/references/providers/minimax-h3-video.md`（上游仓库）
- oh-story-dsh 的 H3 提示词方言：`packages/knowledge/drama/skills/short-drama-video-prompts/references/minimax-h3.md`（上游仓库）
- 本仓库实现：`packages/video/h3-video/src/minimax-api.ts`、`src/validation.ts`、`src/index.ts`、`src/settings.ts`、`packages/video/tool-video/src/index.ts`、`packages/client/ui-settings-plugins/src/client/h3-video-card-controller.ts`
