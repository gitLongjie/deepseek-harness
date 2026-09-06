---
description: "market 组导览：插件发现、经 npm 校验的安装，以及 CLI、wire 与 Web 三类入口——供浏览该组的用户与维护者使用。"
kind: "package-group"
---

# market/ — 插件市场能力族

[English](README.md) | 中文

## 摘要

market 组是插件安装能力族：用户从目录源挑选插件,服务校验候选包的 npm 身份,安装落入受管 profile 成为一个 bundle 层,并在下一次宿主启动时激活。目录源由用户配置且不受信任;npm 注册表是唯一版本权威;所有身份实参都是经宿主校验的不透明 id。该组拆分为服务定义（`market`）、承载目录/注册表/pnpm 实现的本地提供方（`market-local`）,以及 Typert Remote 网关（`market-gateway`）。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`market`](market/README.zh.md) | 定义市场约定:来源注册表、目录浏览、可安装性、安装与卸载 | `ctx.market` |
| [`market-local`](market-local/README.zh.md) | 基于 HTTPS 目录读取、npm 注册表与 profile pnpm 变更实现该约定 | 注册到 `ctx.market` |
| [`market-gateway`](market-gateway/README.zh.md) | 将该约定投影到 Typert wire,供受信任的 Web 客户端使用 | 注册到 `ctx.marketGateway` |

-----

<a id="related-documentation"></a>
## 相关文档

- [插件市场子系统](../../docs/subsystems/market.zh.md) — 市场类型、来源传输与 `ctx.market` API。

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
