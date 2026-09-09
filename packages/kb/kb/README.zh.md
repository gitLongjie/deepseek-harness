---
description: "知识库列表契约:部署的企业知识服务所暴露的库,使用后端分配的不透明 id。"
kind: "package-reference"
---

# @deepseek-ai/dsh-kb

[English](README.md) | 中文

## 概要

`dsh-kb` 声明知识库能力:列出部署的知识服务向所配置凭据暴露的库。库 id 由后端分配且不透明;可见性跟随提供者解析的凭据,列出的库就是部署可读的全部。具体 WeKnora 提供者位于 `dsh-kb-weknora`;消费方是宿主 Remote 网关(`dsh-kb-gateway`)与 Web 客户端的侧边栏知识分区。检索动词在消费方需要时加入本定义。

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

通过服务定义消费 `ctx.knowledgeBase`;挂载一个提供者来供给它。

```yaml
- name: '@deepseek-ai/dsh-kb-weknora'
- name: '@deepseek-ai/dsh-kb-gateway'
```

### 最小配置

无配置:定义不拥有任何字段。其类型是本组的共享词汇。

### 会出什么问题

不挂载提供者会让消费方的 `inject` 在启动时失败——能力要么存在,要么组合配置响亮地说明其缺席。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本包声明抽象 `KnowledgeBase` 服务(`ctx.knowledgeBase`)及其类型,外加包级不变量伴随插件。行为不变量归属各自的所有者。

| 文件 | 拥有 |
|---|---|
| `src/index.ts` | 抽象 `KnowledgeBase` 服务定义与 `ctx.knowledgeBase` 合并 |
| `src/types.ts` | `KnowledgeBaseId` 与 `KnowledgeBaseView`,本组的共享词汇 |
| `src/invariant.ts` | 包不变量伴随插件 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [知识库子系统](../../../docs/subsystems/knowledge-base.zh.md) — 列表类型与 `ctx.knowledgeBase` API。
- [`dsh-kb-weknora`](../kb-weknora/README.zh.md) — WeKnora 提供者。
- [`dsh-kb-gateway`](../kb-gateway/README.zh.md) — 线面投影。

-----

<a id="model-experience"></a>
## 模型体验

间接,通过它服务的列表客户端;本定义不注册任何提示词、工具模式或事件负载。

#### KV Cache 效应

无;本包既不组装也不发送提供者请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅列表** — 检索动词在消费方需要时加入定义;在此之前,客户端只能通过面向模型的知识工具从库中作答。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
