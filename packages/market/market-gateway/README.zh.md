---
description: "市场 wire 投影：通过宿主的 Typert Remote 网关把市场服务暴露给受信任的 Web 客户端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market-gateway

[English](README.md) | 中文

## 摘要

`dsh-market-gateway` 把市场放进宿主经身份验证的 Web 网关:Web 设置页通过该投影读取来源、浏览目录页并发起安装,而不是直接触达服务。每次调用都来自已登录客户端,因此网关原样转发不透明的来源、条目与 bundle id,由 `dsh-market-local` 在宿主侧继续解析包名、版本与命令。任何希望 Web 客户端管理插件的宿主都挂载它。

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

在同时提供 `ctx.market` 实现的宿主上挂载插件;它在 `market` Remote 命名空间下注册 wire 面 `ctx.marketGateway`。

```yaml
- name: '@deepseek-ai/dsh-market-local'
- name: '@deepseek-ai/dsh-market-gateway'
```

### 最小配置

无配置:网关不新增字段。Web 设置页与宿主 Remote 装配是仅有的消费方。

### 什么会出错

网关是纯投影:底层服务拒绝的调用原样传播该拒绝;选中来源未列出的条目解析为 not-found 结果,而不是错误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

插件继承 `TypertRemoteService`,使用 wire 命名空间 `market` 与独立的服务 key `marketGateway`,因此注册永远不会与 `ctx.market` 冲突。它把十一个约定方法逐一投影:来源读取与变更、带查询对象的浏览、可安装性、安装、已安装视图,以及按 bundle id 卸载。`entryDetail` 是唯一改形的方法——约定中的 `undefined` 变为 `{ found: false }` wire 结果,命中则变为 `{ found: true, entry }`——Remote 客户端因此无需为可选性建模。

| 文件 | 拥有 |
|---|---|
| `src/index.ts` | `ctx.market` 的 `MarketGateway` Typert remote 投影 |
| `src/types.ts` | 为 `market` 命名空间生成的 wire 请求/响应类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [插件市场子系统](../../../docs/subsystems/market.zh.md) — 市场类型与 `ctx.market` API。
- [`dsh-market`](../market/README.zh.md) — 被投影的约定。
- [`dsh-market-local`](../market-local/README.zh.md) — 投影背后的提供方。

-----

<a id="model-experience"></a>
## Model Experience

间接生效:经由其服务的 wire 客户端;投影自身不注册 prompt、工具 schema 或事件载荷。

#### KV Cache effect

无直接失效;转发的响应拥有客户端侧上下文效果。

## 已知限制与未竟工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限受信任客户端** — 投影自身不加授权;它依赖宿主网关的已验证会话与提供方的宿主侧校验。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
