---
description: "video 分组地图：MiniMax H3 视频片段生成——ctx.h3Video 接口及其本地与托管 provider、面向模型的视频工具，以及工作台路由——供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# video/ —— 视频生成能力家族

[English](README.md) | 中文

## 概述

video 分组把一次对话变成用 MiniMax H3 渲染的成片。一个服务接口通过本地 ComfyUI 部署或托管 MiniMax API 生成片段，按段显式路由，并用 ffmpeg 把完成的片段拼接成片；其上的模型面向工具负责拆分镜、确定视觉素材、把渲染作为后台任务提交、并拼接结果；工作台则把输出目录投影进 Web 界面，而不给浏览器任何写路径。本组拆分为接口与 provider（`h3-video`）、其消费者（`tool-video`）以及只读投影（`video-workbench`）。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`h3-video`](h3-video/README.zh.md) | 生成接口：`ctx.h3Video`、本地 ComfyUI 与托管 MiniMax provider、显式路由、ffmpeg 拼接，以及 `./settings` 入口 | `ctx.h3Video` |
| [`tool-video`](tool-video/README.zh.md) | 面向模型的 `video_plan`、`video_keyframes`、`video_assets`、`video_asset_images`、`video_render`、`video_assemble` 工具与 `/video` 指令 | 注册到 `ctx.tools` |
| [`video-workbench`](video-workbench/README.zh.md) | 把 H3 输出目录投影给 Web 界面的只读 web-server 路由 | — |

工作台的浏览器半边与其他 Web 插件放在一起：[`client/ui-video-workbench`](../client/ui-video-workbench/README.zh.md)。

-----

<a id="related-documentation"></a>
## 相关文档

- [H3 视频生成工具](../../.agents/notes/implemented/feature/2026-09-29-h3-video-generation-tools.md) —— 接口、provider、工具与素材优先流程。
- [H3 视频用户设置](../../.agents/notes/implemented/feature/2026-10-03-h3-video-user-settings.md) —— `./settings` 宿主入口及其对组合配置的覆盖。
- [H3 生成对齐 oh-story-dsh](../../.agents/notes/implemented/feature/2026-10-06-h3-video-oh-story-alignment.md) —— 能力档位、协议校验与 reference 条件。
- [视频工作台](../../.agents/notes/implemented/feature/2026-10-06-video-workbench.md) —— 只读投影及其路径围堵规则。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本组暂无 `docs/subsystems/` 页面；其服务契约由 `h3-video` 包 README 与上述 Agent Note 承载。当接口类型需要在包 README 之外安家时，可以再补一份 subsystem 参考页。

</details>
