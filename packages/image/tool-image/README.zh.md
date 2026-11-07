---
description: "面向模型的 generate_image 工具：对话模型如何通过 ctx.image 服务与持久附件存储，把文字提示词变成用户可见的图片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image

[English](README.md) | 中文

## 概述

本包注册 `generate_image`，让对话模型根据文字描述生成一张图片。图片通过 [`@deepseek-ai/dsh-image`](../image/README.zh.md) 生成，存为持久附件，并与一段简短的文本信封一起返回，因此用户能在工具调用中看到图片，模型也能查看自己生成的内容。当 DeepSeek 等对话模型需要按请求生成图片时选择它。

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

与 `@deepseek-ai/dsh-image`、至少一个可用的图片提供方以及附件存储一起加载本包。内置基础组合会挂载该服务、本工具与 `attachment-local`；Web `standard` 预设会把工具加到每个 agent。内置组合会在 `llm-deepagens` 写入 `imageModel: gpt-image-2`，因此无需改设置即可让 `deepagens` 提供方可用。

### 何时选择

当模型需要在对话中生成图片时选择它。调用方模型必须声明图片输入，因为生成的图片会以图片块进入历史；在纯文本路由上，工具会在生成前拒绝。若要直接把图片模型当作对话模型，请改为在 `llm-deepagens` 中把它配置为 `endpoint: image-generation` 目录模型。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-image'
- name: '@deepseek-ai/dsh-tool-image'
  config:
    timeoutMs: 180000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `180000` | 单次调用的协作超时预算（毫秒），由工具调用超时策略执行 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-image)是所有可接受字段的完整来源。

### 模型能做什么

- **`generate_image(prompt)`** — 根据完整的画面描述生成一张图片并展示给用户。每次调用都会生成新图片；要修改结果，模型需用修订后的提示词再次调用。

### 成功与失败的表现

成功的调用返回文本信封与图片；Web 工具行会在图集中显示图片。失败表现为带可操作原因的工具错误：提示词为空、调用方模型不支持图片输入、没有可用图片提供方（配置图片模型前为 `IMAGE_PROVIDER_UNAVAILABLE`）、后端拒绝（附带提供方消息），或附件存储拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

### 设计理念

- **先拒绝再花费。** 图片输入路由检查在后端调用前执行，因此纯文本路由不会为无法保留在历史中的图片付费。
- **单一持久记录。** 图片在结果确定前提交到附件存储；输出值携带附件引用，`render` 将其投影为图片块。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、`generate_image` 定义、路由检查、附件提交与呈现 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-image](../image/README.zh.md) — 本工具调用的提供方选择服务。
- [Image 包地图](../README.zh.md) — 分组与各包职责。
- [`llm-deepagens` 配置](../../llm/llm-deepagens/src/config.ts) — 内置的 `deepagens` 图片提供方及其 `imageModel` 设置。
- [添加工具](../../../docs/cookbook/adding-a-tool.zh.md) — 本包遵循的工具定义与呈现规则。

-----

<a id="model-experience"></a>
## 模型体验

### 面向模型的契约

#### 模型看到什么

一个工具 `generate_image`，只有一个必填参数 `prompt`。结果是一段文本信封（列出媒体类型、像素尺寸、字节数与后端模型），后面跟着图片本身。失败是对模型安全的原因说明，从不包含堆栈。

#### Token 影响

在提供该工具的每次请求中，工具定义会增加一段简短描述和一个参数。每次调用会向历史添加信封与一张图片；与其他图片块一样，该图片在后续请求中消耗输入 token。

#### KV Cache 影响

本包不添加系统提示词文本；工具调用与结果追加在可复用的请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只支持文字提示词。** 不暴露尺寸、质量，也不支持用参考图编辑上一张图片。
- **没有工作区文件。** 图片保存在附件存储中；模型无法把它的工作区路径传给其他工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

测试使用脚本化的提供方与目录适配器，驱动真实的工具流水线、`ctx.image` 与本地附件存储。

</details>
