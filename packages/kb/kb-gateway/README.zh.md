---
description: "知识库 wire 投影:通过宿主的 Typert Remote 网关把列表服务暴露给受信任的 Web 客户端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-kb-gateway

[English](README.md) | 中文

## 概要

`dsh-kb-gateway` 把知识库列表放到宿主已认证的 Web 网关之后:侧边栏知识分区通过本投影读取库列表与部署控制台 URL,而不是直连服务。每个调用都来自已登录客户端,网关只转发读取动词,让 `dsh-kb-weknora` 继续独占传输与凭据解析。

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

在同时提供 `ctx.knowledgeBase` 实现的宿主上挂载本插件;它在 `knowledgeBase` Remote 命名空间下注册线面 `ctx.knowledgeBaseGateway`。

```yaml
- name: '@deepseek-ai/dsh-kb-weknora'
- name: '@deepseek-ai/dsh-kb-gateway'
```

### 最小配置

无配置:网关不新增字段。侧边栏知识分区与宿主 Remote 装配是仅有的消费方。

### 会出什么问题

网关是纯投影:底层服务拒绝的调用会传播该拒绝,客户端将其渲染为重试态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本插件扩展 `TypertRemoteService`,线面命名空间为 `knowledgeBase`,自有服务键为 `knowledgeBaseGateway`,注册因此永不与 `ctx.knowledgeBase` 冲突。它一对一投影两个契约方法:库列表读取与部署事实读取。

| 文件 | 拥有 |
|---|---|
| `src/index.ts` | `ctx.knowledgeBase` 的 `KnowledgeBaseGateway` Typert 远程投影 |
| `src/types.ts` | 为 `knowledgeBase` 命名空间生成的线面请求/响应类型 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [知识库子系统](../../../docs/subsystems/knowledge-base.zh.md) — 列表类型与 `ctx.knowledgeBase` API。
- [`dsh-kb`](../kb/README.zh.md) — 被投影的契约。
- [`dsh-kb-weknora`](../kb-weknora/README.zh.md) — 投影背后的提供者。

-----

<a id="model-experience"></a>
## 模型体验

间接,通过它服务的线面客户端;本投影不注册任何提示词、工具模式或事件负载。

#### KV Cache 效应

无直接失效;转发的响应拥有客户端侧的上下文效应。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅受信客户端** — 本投影不新增授权;它依赖宿主网关的已认证会话与提供者的凭据范围可见性。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
