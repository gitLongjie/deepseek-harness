---
description: "后端中立的 MiniMax H3 视频生成服务：本地 ComfyUI 或托管 MiniMax API provider、显式的 local/remote/auto 路由，以及 ffmpeg 拼接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-h3-video

[English](README.md) | 中文

## 概述

本包提供 `ctx.h3Video` 服务：一个后端中立的视频片段生成接口，可用本地 ComfyUI 部署或托管 MiniMax V2 API 运行 MiniMax H3，按段在两者之间显式路由，并用 ffmpeg 把完成的片段拼接成片。面向模型的 `video_plan` / `video_render` / `video_assemble` 工具位于配套的 [`@deepseek-ai/dsh-tool-video`](../tool-video/README.zh.md) 包中。当某个组合需要把对话变成分镜、优先本地渲染并按需降级到托管 API 时选择它。

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

把本包作为服务插件加载，再叠加 `@deepseek-ai/dsh-tool-video` 以暴露工具。至少配置一个后端；配置错误会在加载时响亮失败。后端行通过其锚点字段启用：设置 `comfy.workflowPath` 启用本地 ComfyUI 后端，设置 `minimax.apiKey` 启用托管后端。缺少锚点的行视为未启用。

### 何时选择

当你通过 ComfyUI 在本地运行 MiniMax H3 视频生成，并希望在托管 API 上获得备用能力（更长片段、2K、或本机显存无法服务的内容）时选择它。当没有可用的 H3 workflow 也没有托管 API key 时不要使用——零后端时服务拒绝启动。

### 最小可用示例

针对 `http://127.0.0.1:8188` 的 ComfyUI 部署的纯本地组合：

```yaml
- id: h3-video
  name: '@deepseek-ai/dsh-h3-video'
  config:
    comfy:
      url: 'http://127.0.0.1:8188'
      workflowPath: 'D:/ComfyUI/h3-workflow.json'
      resolutions: ['768P']
      minDurationSeconds: 4
      maxDurationSeconds: 10

- id: tool-video
  name: '@deepseek-ai/dsh-tool-video'
```

加入托管后端只需再配置一行，key 以凭据引用形式给出，不进入仓库或组合文件：

```yaml
    minimax:
      apiKeyRef: 'MINIMAX_API_KEY'
      baseUrl: 'https://api.minimax.cn'
      model: 'MiniMax-H3'
```

`apiKeyRef` 指定一个通过 `ctx.credentials` 在每次请求时解析的凭据名。把 key 存一次到受管凭据存储（或设为 `MINIMAX_API_KEY` 环境变量）；key 绝不写入 `cordis.yml`。测试场景也接受字面量 `apiKey`，但它会落在组合文件里。超出已知 `MiniMax-H3`/`MiniMax-H3-Max` 档位的 release id 需要在同一行补上 `resolutions` 和 `minDurationSeconds`/`maxDurationSeconds`。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-h3-video)是每个字段及其 JSDoc 的权威来源。

### 用户设置覆盖

`./settings` 入口（`@deepseek-ai/dsh-h3-video/settings`）是一个宿主面插件行：注册 `h3-video` 设置命名空间，并把它的实时视图发布为 `h3VideoSettings` 服务。插件设置页编辑该命名空间；字段是组合配置中用户可调的那部分（扁平命名，如 `comfyUrl`、`comfyWorkflowPath`、`minimaxApiKeyRef`、`outputDir`、`minFreeSpaceMb`）。已挂载的服务把提交的分节覆盖在组合值之上——存在且非空的设置生效，缺席的沿用组合值——并在分节变化时重建后端，无需改动预设的组合文件。两个启用开关也随覆盖传递：`comfyWorkflowPath` 启用本地后端，`minimaxApiKeyRef` 启用远端后端，因此一个两者锚点都没有的组合可以完全从设置里启用。MiniMax 密钥本身通过凭据域写入；分节只记引用名。

### 服务做什么

- **提交**一个经过校验的片段请求到某一后端，返回不透明的任务引用。
- **轮询**该引用直到终态；成功时携带下载到本地的文件（远端 URL 有时效，因此托管结果都会抓取到 `outputDir`）。
- **取消**进行中的任务（ComfyUI `POST /interrupt`，或中止轮询请求）。
- **拼接**有序片段文件为单个 mp4，用 ffmpeg 重编码为统一的 h264/yuv420p/24fps 流，保证混合后端与分辨率也能干净拼接。

路由按段显式选择——`local`、`remote` 或 `auto`（本地优先，按能力或可用性回退到远端）。任何调用路径都没有隐式默认。

### 存储布局

所有下载片段、计划与成片都位于可配置的 `outputDir` 之下；省略时默认与 harness 的其他用户数据放在一起：

```
$DSH_HOME/cache/video/            # default outputDir (respects $DSH_HOME; else ~/.dsh/cache/video)
  plans/<planId>.json             # storyboard documents (tool-video)
  segments/<planId>-<segmentId>.mp4  # rendered segment files (deterministic, assembly input)
  final/<planId>.mp4              # assembled deliverable (video_assemble default)
```

provider 的下载直接落在 `outputDir`，由渲染任务改名为 `segments/` 下的确定性路径；不会复制两份。配置的 `outputDir` 中的 `~` 通过共享的主目录解析器展开为 OS 主目录。默认使用 DSH 的 **cache** 语义，因为这里的每个文件都是可重建的中间产物；成片则用于交付给用户（典型做法是 `video_assemble` 之后调用 `present`，或传入显式 `output_file` 让成片落到 workspace 或其他位置）。

### 磁盘空间保护

每次提交都会对输出卷做预检：当剩余空间低于 `minFreeSpaceMb` **加上** `estimatedBytesPerSecond` × 片段时长时，provider 拒绝启动生成；写下载文件前还会再查一次（任务中途磁盘写满会以明确的磁盘已满原因使片段失败，绝不暴露原始 `ENOSPC`）。两者都是部署配置而非常量：按模型真实码率调 `estimatedBytesPerSecond`（H3 768P ≈ 0.5 MB/s，2K 更高），按想保留的余量调 `minFreeSpaceMb`。`ctx.h3Video.diskFreeMegabytes()` 报告当前剩余空间，模型可据此按本地卷的容量选择后端。

### 成功与失败形态

一个已提交的片段要么以 `succeeded` 且携带本地文件结束，要么以 `failed` 且携带模型可读的原因结束（ComfyUI 执行错误、托管任务错误或单任务超时）。当没有配置的后端能服务某片段时，路由会拒绝并指出后端和能力不匹配之处。取消是尽力而为的，绝不会被报为成功。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节说明接口背后的设计决策并指向实现代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

- **能力接口，而非包装器。** `H3Video` 是服务定义；`createComfyUIProvider` 与 `createMiniMaxApiProvider` 是 provider；`tool-video` 是消费者。每个后端拥有自己的传输与文件下载，两者都不拥有重试策略或路由。
- **显式解析。** `resolve` 是选择后端的唯一地点，并且总是在提交前针对所选后端声明的能力校验请求。
- **配置即部署。** 每个可调项（端点、字段名、轮询间隔、超时、并发、分辨率/时长上限）都是经过校验的 `Config` 字段；没有任何硬编码常量。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | `SegmentRequest`、`TaskStatus`、`H3VideoProvider`、`ProviderCapabilities`、`H3TaskRef` 品牌类型 |
| [`src/validation.ts`](src/validation.ts) | 两个 provider 共享的请求规则（文本条数、prompt 长度、时长/分辨率范围、首尾帧与参考输入互斥、首尾帧唯一、引用数量上限、比例规则） |
| [`src/routing.ts`](src/routing.ts) | `resolve`——针对已配置后端的显式 `local`/`remote`/`auto` 选择 |
| [`src/comfyui.ts`](src/comfyui.ts) | 本地 provider：模板填充、`/prompt` 队列、`/history` 轮询、`/view` 下载、`/interrupt` 取消 |
| [`src/minimax-api.ts`](src/minimax-api.ts) | 托管 provider：V2 建任务、任务轮询、限时 URL 下载 |
| [`src/assembly.ts`](src/assembly.ts) | ffmpeg concat 拼接为统一 mp4 |
| [`src/index.ts`](src/index.ts) | `H3Video` 服务类及其默认导出插件接线 |

不发布运行时 invariant 伴生包：该接口不拥有独立观察可能分叉的关系。

### ComfyUI workflow 模板

本地 provider 用每次请求的 prompt、分辨率、时长、比例、种子，以及由时长计算的 `length`（帧数）字段，填充 JSON workflow 模板中的 `"{{field}}"` 占位符。模板是 ComfyUI API 格式的 JSON（`class_type` + `inputs`）；未使用的占位符是无操作，因此一个模板可同时服务纯文本请求，视频节点保持参数化。现成的 H3 模板在 `D:\ComfyUI\ComfyUI\models\h3-t2v-api-template.json`（根据官方 Comfy-Org t2v workflow 构建，使用原生 `MiniMaxH3ImageToVideo` 节点、turbo LoRA，以及 `{{prompt}}` / `{{seed}}` / `{{length}}` 占位符）——把 `workflowPath` 指向它即可。`lengthField` 默认为 `length`；帧数会按模型 24fps 下的 `17k + 5` 网格取整（`snapH3Frames`）。

### 托管 API 表面

托管 provider 镜像 MiniMax V2 视频 API：`POST /v2/video_generation` 建任务，轮询 `GET /v2/query/video_generation/{task_id}`，成功后把限时的媒体 URL 下载到 `outputDir`。已发布档位覆盖已知 release——`MiniMax-H3` 服务 4–15 秒、768P/2K；`MiniMax-H3-Max` 服务 5–15 秒、480P/768P——但账号开通了哪个 release 是部署配置：`model` 接受任意 release id，没有已发布档位的 id 必须携带 `minimax.resolutions` 和 `minimax.minDurationSeconds`/`maxDurationSeconds`，否则服务在加载时响亮失败而不是猜测档位。

参考输入遵循已发布的内容规则。本地文件以内联 base64 data URI 提交，超过单模态上限（图片 30 MB、视频 50 MB、音频 15 MB）会被拒绝；整个创建体在 base64 展开后超过 64 MB 也会被拒绝——把素材放到可访问的主机上改传 https URL（或 MiniMax 文件服务的 `mm_file://{file_id}`，按原样透传），而不是拆分它。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [tool-video 包](../tool-video/README.zh.md)——本服务之上的模型面向工具。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-h3-video)——每个配置字段及其 JSDoc。

-----

<a id="model-experience"></a>
## 模型体验

### 模型面向契约

#### 模型看到什么

`tool-video` 工具以紧凑 JSON 暴露计划、提交记录与拼接结果。每个失败都是可读的原因，指明片段或后端，绝不含原始堆栈或 HTTP 转储。取消与超时状态是显式的，模型无需猜测即可重试或改路由。

#### Token 影响

provider 代码完全运行在模型循环之外；模型只看到 `tool-video` 返回的紧凑规范 JSON。轮询与下载从不流入历史。

#### KV Cache 影响

本服务不添加系统提示文本，也不添加每次请求前缀，因此不会扰动 LLM provider 的可复用请求前缀。工具调用与结果照常在其后追加。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **计划以文件存储，而非会话事件。** `video/plan` 会话日志事件会牵扯持久化目录与会话格式版本机制，因此计划是 `outputDir` 下的 JSON 工件。会话回放会在 `tool/result` 中看到计划，但没有一等公民的投影。
- **ComfyUI 图像条件需要 `comfy.inputDir`。** 本地工作流通过把每张图片复制进 ComfyUI input 目录并接进 H3 节点来服务关键帧与参考图条件，因此未配置该目录时图像条件请求会响亮失败。视频/音频引用仍路由到托管 API。
- **并发在接口处是建议性的。** `maxConcurrency` 通过 capabilities 供消费者参考；接口本身不做超出各后端行为的排队。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

ComfyUI 输出选择器优先视频、其次 GIF、再其次 `type: output` 图片，因此产出图片的 workflow（text2img 冒烟测试或图像序列节点）仍会以 `succeeded` 结束并下载文件。[`scripts/e2e-smoke.mts`](scripts/e2e-smoke.mts) 手动冒烟脚本用 text2img checkpoint 驱动真实本地服务器并做 ffmpeg 拼接；它不属于测试套件。

</details>
