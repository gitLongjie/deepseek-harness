---
description: "WeKnora 知识库服务提供者:每次读取一个有界请求,列出部署向所配置凭据暴露的库。"
kind: "package-reference"
---

# @deepseek-ai/dsh-kb-weknora

[English](README.md) | 中文

## 概要

`dsh-kb-weknora` 在自托管 WeKnora 部署之上挂载 `ctx.knowledgeBase`:每次读取一个 `GET /knowledge-bases` 请求,带墙钟时间上界、响应体大小上界与逐次凭据解析,轮换后的密钥无需重启即可到达下一次调用。base URL 是部署自有配置且通常位于内网,因此与市场传输不同,本提供者不设公网地址守卫——配置的 URL 就是信任决策。侧边栏知识分区经线面网关消费它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 客户端需要看到部署知识库的宿主上挂载本插件;它注册 `ctx.knowledgeBase`。

```yaml
- id: kb-weknora
  name: '@deepseek-ai/dsh-kb-weknora'
  config:
    baseUrl: http://weknora.internal:8080/api/v1
```

### 最小配置

`baseUrl` 默认指向标准 `docker compose up` 部署(`http://localhost:8080/api/v1`);凭据引用默认 `WEKNORA_API_KEY`,经凭据接缝逐次解析。设 `apiKeyEnv: ''` 声明无鉴权部署,平台级密钥配 `tenantId`,配 `webUiUrl` 让客户端分区获得管理入口。

### 会出什么问题

非法配置——非 http(s) 的 `baseUrl` 或 `webUiUrl`、超出凭据语法的引用——在插件加载期失败。运行期失败(部署不可达、HTTP 错误、违反契约的负载)以 `WeknoraKnowledgeBaseError` 经网关冒泡,渲染为客户端分区的重试态;错误消息永不携带凭据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

提供者扩展 `KnowledgeBase` 服务定义并逐次解析凭据。响应负载由部署控制但仍做契约校验:非数组列表或缺少 id 的库会抛错而非静默清空列表;缺失显示名回退为 id。

| 文件 | 拥有 |
|---|---|
| `src/index.ts` | `WeknoraKnowledgeBase` 提供者:配置、有界传输、信封契约 |
| `src/invariant.ts` | 包不变量伴随插件 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [知识库子系统](../../../docs/subsystems/knowledge-base.zh.md) — 列表类型与 `ctx.knowledgeBase` API。
- [`dsh-kb`](../kb/README.zh.md) — 本提供者挂载的契约。

-----

<a id="model-experience"></a>
## 模型体验

间接,通过它服务的列表客户端;本提供者不注册任何提示词、工具模式或事件负载。

#### KV Cache 效应

无;本包既不组装也不发送提供者请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅列表** — 本提供者读取部署的库列表;检索仍由面向模型的 `dsh-weknora` 工具承担,直到有消费方需要它进入本接缝。
- **无公网地址守卫** — 市场传输的 HTTPS-only 公网主机规则在此刻意不适用;需要该策略的部署必须在自己的边界上拥有它。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
