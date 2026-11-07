---
description: "image 分组地图：ctx.image 图片生成能力缝与面向模型的 generate_image 工具，供浏览该分组的用户与维护者使用。"
kind: "package-group"
---

# image/ — 图片生成能力族

[English](README.md) | 中文

## 概述

image 分组让对话模型在对话中生成图片。一个服务能力缝负责选择图片后端并返回编码后的字节；面向模型的工具把一段文字提示词变成一张图片，存为持久附件并展示给用户。后端由各自的传输所有者提供：`llm-deepagens` 中的 Deepagens 网关路由注册 `deepagens` 提供方。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`image`](image/README.zh.md) | 生成能力缝：提供方注册表、执行时选择与 `ImageError` 错误分类 | `ctx.image` |
| [`tool-image`](tool-image/README.zh.md) | 面向模型的 `generate_image` 工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [图片生成子系统](../../docs/subsystems/image.zh.md) — `ctx.image` 词汇、提供方协议与生成的 Cordis API。
- [Web 能力缝决策](../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) — 本能力缝沿用的注册与选择规则。
- [`llm-deepagens` 配置](../llm/llm-deepagens/src/config.ts) — 通过 `imageModel` 设置提供内置图片后端的网关路由。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

H3 视频工具仍调用各自的图片后端，把它们迁移到 `ctx.image` 是待办工作。

</details>
