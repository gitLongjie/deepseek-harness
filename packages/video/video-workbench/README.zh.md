---
description: "只读视频工作台：把 h3-video 输出目录投影给浏览器的工作台列表与文件路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-video-workbench

[English](README.md) | 中文

## 概述

本包是视频工作台的宿主半边：两条只读 web-server 路由，投影 h3-video 输出目录——即 `tool-video` 流水线写入计划、关键帧、分镜与成片的同一目录。`GET /api/video-workbench/projects` 列出计划工件及其落盘渲染状态；`GET /api/video-workbench/file?path=<相对路径>` 服务被限制在该目录内的单个白名单文件。浏览器半边（侧栏面板行与项目目录页）位于 [`@deepseek-ai/dsh-client-ui-video-workbench`](../../client/ui-video-workbench/README.zh.md)。当部署希望视频成片可在 Web 界面浏览、又不给浏览器任何写路径时选择它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与遗留工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把本包作为宿主插件加载（web-app bundle 已携带）。配置只有一个可选字段：

```yaml
- id: video-workbench
  name: '@deepseek-ai/dsh-video-workbench'
```

`outputDir` 缺省为 DSH cache 的 `video` 目录（`$DSH_HOME/cache/video`）——与 `h3-video` 服务的缺省一致——因此标准部署无需配置。视频服务配置了自定义目录时，用 `outputDir` 指过去（`~` 展开为系统用户目录）。

两条路由只应答 `GET`/`HEAD`。文件服务只放行白名单扩展（`.json`/`.md`/`.txt`、图片、视频、音频），单文件上限 256 MB；请求路径被拆成纯名字段（无 `..`、无盘符），在投影根下拼接，并在符号链接解析后复查，因此目录之外的任何内容都不会被应答。损坏的计划变成列表里的一条错误行，而不是拖垮整个列表。

<a id="understand-the-implementation"></a>
## 理解实现

- [`src/projects.ts`](src/projects.ts) 扫描 `plans/*.json`，逐项目报告版本、目标、模式、逐镜头渲染状态、关键帧路径与成片；multi_shot 计划折叠到合成的 `all` 段。
- [`src/file-serve.ts`](src/file-serve.ts) 拥有包含性解析器、扩展白名单与流式响应。
- [`src/index.ts`](src/index.ts) 经 `ctx.effect` 下的 `ctx.webServer.register` 注册两条路由，路由行的存活期与插件一致。

**运行时不变量：** 不发布 companion。两条路由每次请求都读取输出目录，不持有跨请求状态，因此没有被拥有的关系可供 companion 观察。

<a id="model-experience"></a>
## Model Experience

### Model-facing contract

#### What the model sees

什么都看不到。工作台不注册工具、不发会话事件；模型循环不知道它的存在。浏览器页面是 `GET /api/video-workbench/projects` 与 `GET /api/video-workbench/file` 的唯一消费者。

#### Token effect

无影响：路由是对浏览器的只读 HTTP 应答，从不进入模型请求或会话记录；`plans/*.json` 的扫描发生在宿主进程内。

#### KV Cache effect

无影响：本包不添加系统提示文本，也没有逐请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

<a id="已知限制与遗留工作"></a>

- **没有字节区间应答。** 文件路由整文件应答；浏览器先缓冲再 seek。等把 range 头解析误报为命令注入的写入门禁规则修正后，可以补上 Range 支持。
- **没有分页或推送。** 列表每次请求扫描全部 `plans/*.json`；大目录的自然扩展是路由加 `?since=` 查询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

路由经 `ctx.effect` 下的 `ctx.webServer.register` 注册，行存活期与插件一致。文件服务的包含性检查顺序是：段白名单 → 扩展白名单 → `realpath` 双端解析 → `relative` 复查；调整任何一步前先读 `tests/workbench.spec.ts` 里对应的拒绝用例。双语对的 ToC 锚点必须保持英文 slug，两侧链接才会一致。

</details>
