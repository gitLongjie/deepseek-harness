---
description: "面向实现者与消费方的插件市场服务约定：来源注册表、目录浏览、npm 身份可安装性，以及 profile 安装结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market

[English](README.md) | 中文

## 摘要

`dsh-market` 让用户从目录源挑选插件并安装进受管 profile。服务列出用户配置的来源、浏览其归一化目录条目、校验每个条目恰好映射到一个 npm 包——确切稳定版本且声明 dsh bundle——并以该确切版本运行 profile 包管理器。id 不透明且经宿主校验:客户端把来源与条目 id 回传给服务,包名、版本与命令全部由服务自行解析。本包只提供约定;HTTPS 目录、npm 注册表与 pnpm 实现位于 `dsh-market-local`。

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

为你想要的入口加载本包的消费方——`dsh market` CLI、宿主 Remote 网关或 Web 设置页——再加一个诸如 `dsh-market-local` 的提供方。要编写新的提供方,继承导出的 `Market` 服务类;抽象方法即全部约定。

### 何时选择它

实现或消费市场能力时选择本包。只想安装一次某个包时跳过它:`dsh plugin --profile <name> add <package>` 无需任何目录即可完成。

### 最小可用组合

```yaml
- name: '@deepseek-ai/dsh-market-local'
- name: '@deepseek-ai/dsh-market-gateway'
```

`dsh-market-local` 注册 `ctx.market`;网关把它投影到 wire 供 Web 设置页使用。CLI 读取同一服务,无需额外挂载。

### 什么会出错

来源未列出的条目无法安装,npm 校验失败的安装返回点名未满足要求的失败结果。没有操作会在会话中途激活:新的 bundle 层在下次宿主启动时加载。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

本包导出抽象 `Market` 服务类及其类型词汇;Context merge 声明 `ctx.market`。每个抽象方法都是一次对选中来源或受管 profile 的异步操作:`listSources`、`selectedSource`、`selectSource`、`addSource`、`removeSource`、`browse`、`entryDetail`、`installability`、`install`、`installed` 与 `uninstall`。类型承载跨边界的约定——来源、条目与 bundle 身份的品牌化 id;从不泄漏提供方载荷字段的归一化目录条目;以及失败时带有界输出尾随的可辨识安装/卸载结果。

| 文件 | 拥有 |
|---|---|
| `src/index.ts` | 抽象 `Market` 服务定义与 `ctx.market` Context merge |
| `src/types.ts` | 所有提供方与消费方共享的市场类型词汇 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [插件市场子系统](../../../docs/subsystems/market.zh.md) — 类型定义与 `ctx.market` 服务 API。
- [`dsh-market-local`](../market-local/README.zh.md) — 随附提供方及其目录来源约定。
- [Profile 与补丁层](../../../docs/architecture.zh.md) — bundle 层如何加入 profile。

-----

<a id="model-experience"></a>
## Model Experience

间接生效:CLI、网关与 Web 消费方拥有市场约定的全部模型侧或用户侧投影。

#### KV Cache effect

无直接影响;本服务不注册自己的 prompt、工具 schema 或事件载荷。

## 已知限制与未竟工作

<a id="known-limitations-and-deferred-work"></a>

本约定刻意保持传输层面的精简;这些约束由该选择派生。

- **没有提供方侧推送** — 目录变更在提供方缓存生命周期内的下一次读取时浮现;没有变更 feed。
- **每个提供方管理一个 profile** — 约定不涉及多 profile 故事;提供方实现自行选定其管理的 profile。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
