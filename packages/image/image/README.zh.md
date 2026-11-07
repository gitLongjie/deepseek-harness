---
description: "图片生成服务（ctx.image）：部署与插件作者如何通过可替换的提供方生成图片，共用一套选择策略与错误词汇。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image

[English](README.md) | 中文

## 概述

使用 `dsh-image` 根据文字提示词生成图片，调用方无需绑定特定后端。它为每次请求选择一个可用的提供方，并为调用方提供一致的取消与结构化错误。需要调用 `ctx.image.generate()` 的插件或工具应选择它；内置的 `dsh-tool-image` 工具会自动加载它。生成图片需要已注册且可用的提供方，本包自身不发起网络请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

需要图片生成的组合加载 `dsh-image` 服务并挂载至少一个提供方；插件或工具作者随后调用 `ctx.image.generate()`。服务在每次调用时解析提供方，因此除非显式配置，调用方看不到提供方 id。

### 何时选择

当插件或工具需要生成图片且不想硬编码供应商时选择本服务。只使用内置 `generate_image` 工具的部署会通过基础组合获得它。没有可用提供方时，每次调用都会抛出结构化的 `ImageError`。

### 最小配置

加载服务并让唯一可用的提供方自动选中，或用 `provider` 固定一个。在内置组合中，`llm-deepagens` 注册 `deepagens` 提供方并写入 `imageModel: gpt-image-2`，因此无需改设置即可生图；登录时会把该 id 替换为网关目录中第一个带 `image-generation` 标签的模型。

```yaml
- name: '@deepseek-ai/dsh-image'
- name: '@deepseek-ai/dsh-llm-deepagens'
  config:
    protocol: chat-completions
    baseURL: https://claw.deepagens.com/v1
    imageModel: gpt-image-2
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | （未设置） | 固定的提供方 id；未设置时在恰好一个可用时自动选择 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-image)是所有可接受字段的完整来源。

### 生成图片

`generate()` 把一条提示词发送给选中的提供方，返回编码后的字节、媒体类型，以及提供方报告的后端模型。可选的 `AbortSignal` 会转发给提供方。

```text
const image = await ctx.image.generate({ prompt: 'a quiet bay at dawn' }, signal)
// image.data: Uint8Array, image.mediaType: 'image/png', image.model: 'gpt-image-2'
```

### 提供方选择

每次调用都在执行时解析提供方；注册与加载顺序不影响结果。

| 情况 | 结果 |
|---|---|
| 配置的 id 已注册且可用 | 运行该提供方 |
| 配置的 id 未注册 | `IMAGE_PROVIDER_CONFIGURED_MISSING` |
| 配置的 id 已注册但不可用 | `IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 未配置 id，恰好一个可用提供方 | 运行它 |
| 未配置 id，没有可用提供方 | `IMAGE_PROVIDER_UNAVAILABLE` |
| 未配置 id，多个可用提供方 | `IMAGE_PROVIDER_AMBIGUOUS` |

提供方的 `available()` 是廉价的本地检查（例如是否配置了模型），从不发起网络请求。

### 失败与恢复

选择失败会抛出带上述代码之一的 `ImageError`；重复的提供方 id 在注册时抛出 `IMAGE_DUPLICATE_PROVIDER`。提供方自身的失败（例如后端返回 HTTP 拒绝）会原样传播，并保留提供方自己的错误代码。要更换后端，可固定 `provider`、挂载或卸载提供方，或修正提供方配置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

### 设计理念

- **选择从不依赖顺序。** 服务要么运行固定的提供方，要么运行唯一可用的提供方，在调用 `generate()` 时解析。
- **返回字节而非附件。** 能力缝返回编码后的字节，由各消费方决定如何持久化；`dsh-tool-image` 将其提交到附件存储。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`ImageRuntime` 服务、提供方注册表与执行时选择 |
| [`src/types.ts`](src/types.ts) | 词汇：请求与结果类型、提供方协议与 `ImageError` 错误分类 |

### 注册

提供方通过调用方 fiber 上的 effect 注册，并在其销毁时注销，因此热重载的提供方插件不会留下陈旧条目。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Image 包地图](../README.zh.md) — 分组与各包职责。
- [dsh-tool-image](../tool-image/README.zh.md) — 基于本服务的面向模型 `generate_image` 工具。
- [`llm-deepagens` 配置](../../llm/llm-deepagens/src/config.ts) — 内置的 `deepagens` 提供方及其 `imageModel` 设置。
- [Web 能力缝决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) — 本能力缝沿用的选择规则。

-----

<a id="model-experience"></a>
## 模型体验

间接体现：通过 `dsh-tool-image` 向模型呈现生成的图片；本服务不贡献提示词或 schema。

#### KV Cache 影响

无直接失效；由上述消费方负责任何请求前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **请求只携带 `prompt`。** 尺寸、质量、数量以及用于编辑的参考图，待有消费方需要且后端能够支持时再加入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

H3 视频的图片后端（MiniMax 与 ComfyUI）早于本能力缝，仍通过 `ctx.h3Video` 运行；把它们注册为 `ctx.image` 提供方是待办工作。

</details>
