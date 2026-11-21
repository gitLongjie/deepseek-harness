---
description: "专家中心 wire 投影：通过宿主的 Typert Remote 网关把市场的 expert 分类暴露给受信任的 Web 客户端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-expert-hub

[English](README.md) | 中文

## 概述

`dsh-expert-hub` 把市场的 `expert` 分类放进宿主经身份验证的 Web 网关：专家页通过该投影读取可安装卡片并发起安装，而不是直接触达市场服务。网关还在 token-api 专家中心上列出、上传并安装在线专家模块，并为详情对话框读取一张卡片的人设。所有调用均已登录，因此网关原样转发不透明的来源、条目与 bundle id，由 `dsh-market-local` 在宿主侧解析包名、版本与命令。上传使用已登录的 `DEEPAGENS_API_KEY`；本账号保存的卡片（`origin` 缺省或为 `mine`）与目录不在 `.agent-presets` 下的预设可以上传；从广场安装的专家不能上传。

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

`origin` 可选，默认是 `https://claw.deepagens.com`。专家页与宿主 Remote 装配是消费方。上传和广场下载还需要宿主上的 `dsh-credentials` 与 `dsh-expert-publish`；没有它们时这两个方法返回拒绝，npm 目录仍然可用。

### 什么会出错

网关是纯投影：底层服务拒绝的调用原样传播该拒绝；未选中来源时的目录读取返回市场提供方给出的空页。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

插件以 wire 命名空间 `expertHub` 与同名服务键扩展 `TypertRemoteService`。它投影 `catalog`（市场 `expert` 分类）、`installEntry`、`uninstall`、`plaza`、`uploadable`、`versions`、`detail`、`publishModule` 与 `installModule`。线名不用 `install` 或 `remove`，因为这两个名字会与 Remote 客户端的命名空间服务冲突。`plaza`、`uploadable`、`versions` 与 `detail` 是读者读取；`publishModule` 与 `installModule` 是所有者动作。下载的模块经 `ctx.expertPublisher` 注册，因此不必重启即可聘用。`publishModule` 先读已保存的专家文件，否则读系统自带预设目录。`versions` 返回每份本机专家已保存的版本；从广场安装的专家还会带上已发布版本，供卡片判断能否更新。

| 文件 | 职责 |
|---|---|
| `src/index.ts` | `ExpertHubGateway`，对 `ctx.market` 的 Typert remote 投影，以及在线模块方法 |
| `src/online.ts` | token-api 广场、上传与安装 |
| `src/shipped.ts` | 从系统自带预设目录读取人设与技能 |
| `src/types.ts` | wire 请求/响应类型；`package.json` 的 `exports["./types"].types` 指向此处，使 Client 类型检查在 `lib/types` 写出前即可解析 |

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
- **两份目录** — npm 商店条目留在 `catalog`；在线模块留在 `plaza`。已上架 roster 专家仍通过 `agentPresets.list` 到达。宿主不执行上传模块里的脚本。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
