---
description: "dsh Web 客户端的知识库插件:侧边栏入口行打开整页——库列表与文档浏览器并列。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-base

[English](README.md) | 中文

## 概要

`dsh-client-ui-knowledge-base` 是 dsh Web 客户端的知识页面:侧边栏的一个入口行在会话区打开该页——库列表与文档浏览器(名称/类型/更新时间)并列,带内联文档搜索、部署控制台动作,以及每个库的"提问"动作(新建会话)。数据经 `knowledgeBase` Remote 命名空间到达,因此页面对 WeKnora 的传输一无所知也能渲染。

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

Web bundle 默认挂载本插件;移除该行(连同 `kb-weknora` 与 `kb-gateway` 宿主行)即可关闭该界面。

```yaml
- id: ui-knowledge-base
  name: '@deepseek-ai/dsh-client-ui-knowledge-base'
```

### 最小配置

本包无自身配置:分区从网关读取部署事实(`list` + `describe`)。失败或空的列表渲染为状态行——可重试的错误、加载中或空态——绝不会是坏掉的区域。

### 会出什么问题

分区注册进 shell 声明的 `sidebar.knowledge` 洞;移除 ui-sidebar 的声明(或 shell)会让注册等待、分区缺席,这正是空插槽的文档化行为。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

两个插槽注册:`KnowledgeBaseSection` 填充 `sidebar.knowledge`,带持久化折叠 store、覆盖 Remote 面与 Workspace UI 共享新建会话动作的 inject 工厂,以及本包的 `knowledge` 词典命名空间。头部、搜索与竖轨惯例镜像工作区浏览器,让两个分区读起来是一个区域。

| 文件 | 拥有 |
|---|---|
| `src/client/index.ts` | `sidebar.knowledge` 注册、词典与 inject 工厂 |
| `src/client/KnowledgeBaseSection.tsx` | 分区:头部、搜索、状态、库行、竖轨 |
| `src/client/stores.ts` | 持久化折叠 store |
| `src/client/contract/slots.ts` | 注入共享与 props 组合 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [知识库子系统](../../../docs/subsystems/knowledge-base.zh.md) — 列表类型与 `ctx.knowledgeBase` API。
- [`dsh-client-ui-workspace`](../ui-workspace/README.zh.md) — 本分区之上渲染的区域。
- [插槽子系统](../../../docs/subsystems/slots.zh.md) — 本注册使用的洞/占用者模型。

-----

<a id="model-experience"></a>
## 模型体验

间接:分区调用宿主侧的 knowledgeBase 服务,由它独占一切面向模型的效应。

#### KV Cache 效应

无;本包既不组装也不发送提供者请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅浏览行** — 点击库行打开文档浏览器;把会话的知识工具限定到所选库,要等按会话的 agent preset 到来。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
