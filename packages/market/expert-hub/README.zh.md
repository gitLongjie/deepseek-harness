---
description: "专家中心 wire 投影：通过宿主的 Typert Remote 网关把市场的 expert 分类暴露给受信任的 Web 客户端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-expert-hub

[English](README.md) | 中文

## 概述

`dsh-expert-hub` 把市场的 `expert` 分类放进宿主经身份验证的 Web 网关：专家页通过该投影读取可安装专家卡片并发起安装，而不是直接触达市场服务。每次调用都来自已登录客户端，因此网关原样转发不透明的来源、条目与 bundle id，由 `dsh-market-local` 在宿主侧继续解析包名、版本与命令。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与未竟工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同时提供 `ctx.market` 实现的宿主上挂载插件；它在 `expertHub` Remote 命名空间下注册 wire 面 `ctx.expertHub`。

```yaml
- name: '@deepseek-ai/dsh-market-local'
- name: '@deepseek-ai/dsh-expert-hub'
```

### 最小配置

无配置：网关不新增字段。专家页与宿主 Remote 装配是仅有的消费方。

### 什么会出错

网关是纯投影：底层服务拒绝的调用原样传播该拒绝；未选中来源时的目录读取返回市场提供方给出的空页。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

插件以 wire 命名空间 `expertHub` 与同名服务键扩展 `TypertRemoteService`。它投影三个方法：`catalog` 以 `category: 'expert'` 浏览市场，`installEntry` 转发来源本地条目引用，`remove` 按 bundle id 卸载。

| 文件 | 职责 |
|---|---|
| `src/index.ts` | `ExpertHubGateway`，对 `ctx.market` 的 Typert remote 投影 |
| `src/types.ts` | `expertHub` 命名空间的 wire 请求/响应类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [插件市场子系统](../../../docs/subsystems/market.zh.md) — 市场类型与 `ctx.market` API。
- [`dsh-market`](../market/README.zh.md) — 被投影的契约。
- [`dsh-market-local`](../market-local/README.zh.md) — 投影背后的提供方。
- [`dsh-client-ui-expert`](../../client/ui-expert/README.zh.md) — 消费该目录的专家页。

-----

<a id="model-experience"></a>
## Model Experience

间接地，通过它所服务的 wire 客户端；该投影自身不注册 prompt、工具 schema 或事件载荷。

#### KV Cache effect

无直接失效；转发的响应拥有任何客户端上下文效应。

## 已知限制与未竟工作

<a id="known-limitations-and-deferred-work"></a>

- **仅受信任客户端** — 投影自身不加授权；依赖宿主网关的已认证会话与提供方的宿主侧校验。
- **仅市场支撑** — 中心只接纳 `expert` 分类的商店条目；已上架 roster 专家仍通过 `agentPresets.list` 到达，不经此 wire。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
