---
description: "DeepSeek API key 鉴权与模型发现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek-api-key

[English](README.md) | 中文

## 概述

为 `deepseek-official` 注册鉴权和模型发现。通过 [llm-deepseek](../llm-deepseek/README.zh.md) 共用 Messages 请求实现；本包拥有凭据解析和目录可用性判断。本包不请求模型列表。

鉴权解析将验证后的 API key 放入 `x-api-key`，供 Messages 和 Files 请求共同使用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

`apiKeyEnv` 默认为 `DEEPSEEK_API_KEY`，在每次请求和模型发现时解析凭据。已组合 credentials 服务时，按其优先级解析；只有未组合该服务时才直接读取启动环境。请求时凭据缺失以 `MISSING_CREDENTIAL` 失败；格式错误以 `INVALID_CREDENTIAL` 失败。模型发现在凭据缺失时返回空目录，在模型选择器中隐藏该路由，但保留其设置入口。凭据格式错误和其他读取失败继续上报。添加或删除密钥会影响下一次模型发现。

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    reasoningEffort: high
    apiKeyEnv: DEEPSEEK_API_KEY
```

端点和凭据引用来自同一次配置解析；进行中的请求保留该快照，后续配置更新仅影响后续请求。账号登录态不影响该路由使用的凭据。

`models` 是该 provider 的目录；默认值和协议能力来自共享传输包。路由提供这份目录，不请求 `GET /models`，包括官方端点 `https://api.deepseek.com`。目录判断不探测推理端点。`modelsTimeoutMs` 与 `modelsMaxAgeMs` 仍被接受，以便已有配置能够加载；它们不会发出列表请求。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `modelsTimeoutMs` | `5,000` | 仍被接受；本路由不发送列表请求 |
| `modelsMaxAgeMs` | `600,000` | 仍被接受；本路由不发送列表请求 |

设置命名空间采用 Cordis entry id，没有 entry 时采用插件名。产品保留 official 的 `llm-deepseek` entry id，账号使用 `llm-deepseek-account`。

<a id="understand-the-implementation"></a>
## 理解实现

注册随插件生命周期释放。共享 Host 绑定提供附件访问、请求扩展、匿名标识和重试策略的原子更新；本包只注册自己的路由。模型发现在 API key 解析成功后读取配置的目录，不调用列表缓存。

<a id="further-exploration"></a>
## 进一步探索

[LLM streaming](../../../docs/subsystems/llm-streaming.zh.md) · [Messages](../llm-deepseek/README.zh.md) · [API key 路由不请求列表](../../../.agents/notes/implemented/simplification/2026-11-04-api-key-route-skips-model-listing.zh.md)

<a id="model-experience"></a>
## 模型体验

### 已鉴权的模型请求

#### What the model sees

`deepseek-official` 请求不包含本插件添加的模型可见文本；请求由共享 Messages 传输序列化。

#### Token effect

鉴权和模型发现不增加输入 token。每个模型的上下文窗口和默认输出上限来自配置的目录，每次请求记录的上下文和请求头会写明这些值。

#### KV Cache effect

凭据与目录可用性不进入模型输入；协议传输拥有请求前缀的序列化。目录改变某个模型的 system prompt 模式或工具更新模式时，之后的 system prompt 更新或工具更新的序列化方式随之改变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 配置的目录是配置元数据，不验证远端是否接受模型；实际调用仍可能失败。
- 服务端之后新增的模型不会进入本路由，直到发版更新内置目录，或部署配置写入 `models`。

<a id="dev-note"></a>
### 开发备注

注册与鉴权的测试也覆盖共享传输包中的 Loader 组合场景。
