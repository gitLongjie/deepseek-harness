---
description: "知识库包组地图：列表服务定义、WeKnora 提供者,以及线面与 Web 界面——帮助使用者与维护者导航本组。"
kind: "package-group"
---

# 知识库包组

[English](README.md) | 中文

## 概要

`kb/` 包组命名企业知识部署所暴露的内容:一个提供者中立的列表服务(`ctx.knowledgeBase`)、WeKnora 后端,以及读取它的界面。部署把 WeKnora 提供者指向自己的实例,宿主 Remote 网关把列表投影给 Web 客户端的侧边栏知识分区,因此后端更替时客户端界面保持稳定。三个包分担该组:`kb/` 服务定义、WeKnora 提供者、线面网关。本组只拥有列表能力:检索动词在消费方需要时加入定义,面向模型的知识工具由单独挂载的 `dsh-weknora` 插件提供。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发注记](#dev-note)

-----

<a id="packages"></a>
## 包

三个包承担知识库角色。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`kb/`](kb/README.zh.md) | 列表服务定义:部署知识服务暴露的库 | `ctx.knowledgeBase` |
| [`kb-weknora/`](kb-weknora/README.zh.md) | 通过自托管 WeKnora 部署列出库 | 注册 `ctx.knowledgeBase` |
| [`kb-gateway/`](kb-gateway/README.zh.md) | 把列表投影到 `knowledgeBase` Remote 命名空间 | 注册 `ctx.knowledgeBaseGateway` |

Web 客户端的侧边栏分区位于 [`@deepseek-ai/dsh-client-ui-knowledge-base`](../client/ui-knowledge-base/README.zh.md),与其余浏览器半区一样在本组之外。

-----

<a id="related-documentation"></a>
## 相关文档

- [知识库子系统](../../docs/subsystems/knowledge-base.zh.md) — 列表类型与 `ctx.knowledgeBase` API。

<a id="dev-note"></a>
## 开发注记

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
