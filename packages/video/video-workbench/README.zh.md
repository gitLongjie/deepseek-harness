---
description: "视频工作台：把 h3-video 输出目录投影给浏览器的项目列表、文件与删除路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-video-workbench

[English](README.md) | 中文

## 概述

在 Web GUI 中浏览视频计划、角色与场景素材、关键帧、镜头片段及成片，并把删除的项目或素材文件放入可恢复的回收目录。工作台直接读取 `tool-video` 的输出目录，保留分镜及素材引用关系。默认与 `h3-video` 共用输出目录。侧栏和项目页面由[浏览器插件](../../client/ui-video-workbench/README.zh.md)提供。

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

读路由只应答 `GET`/`HEAD`；两条删除路由应答带 JSON 体（`{id}` 或 `{planId, assetId}`）的 `POST`，并在触碰任何路径之前校验 id 形状。删除把文件移到 `<cache>/video-trash/<时间戳>-<id>-<唯一后缀>/` 下的原相对位置，误点可以手工恢复；不执行 unlink。它们注册在 Connection 的精确 Fetch 注册表上——即浏览器 `/api` 路由与桌面外壳进程内传输共用的分发入口——因此请求先经过 Connection 的 Host/Origin 围栏与浏览器认证才会到达路由。文件服务只放行白名单扩展（`.json`/`.md`/`.txt`、图片、视频、音频），单文件上限 256 MB；请求路径被拆成纯名字段（无 `..`、无盘符），在投影根下拼接，并在符号链接解析后复查，因此目录之外的任何内容都不会被应答。损坏的计划变成列表里的一条错误行，而不是拖垮整个列表。多镜头任务保留全部原始分镜，包括编号、提示词、时长、运镜、分辨率、画幅和后端；未记录模式时采用生成插件的默认值 `multi_shot`。该模式的 `segments/<planId>-all.mp4` 即成片，与 `video_assemble` 一致；逐段模式使用 `final/<planId>.mp4`。

列表还会投影每个计划记录的角色/场景/道具素材：参考图、角色母图、规范 prompt 块，以及项目资产库（`assets/library.json`）是否按名收录该素材。只有文件路由确实能服务时才报告图片路径——位于投影目录内且扩展在白名单内——因此用户放在别处的本地照片只会以文字列出，而不是给出一条失效的图片地址。资产库缺失或损坏时按空库处理：这份投影报告的是渲染状态，坏掉的库不该让项目消失。

<a id="understand-the-implementation"></a>
## 理解实现

- [`src/projects.ts`](src/projects.ts) 扫描 `plans/*.json`，逐项目报告版本、目标、模式、逐镜头渲染状态、关键帧路径、成片，以及已记录素材（可服务的图片与库状态）；multi_shot 计划把原始 `shots` 分组到合成的 `all` 渲染任务下。浏览器仅导入列表类型，不把宿主代码打包进浏览器工件。
- [`src/file-serve.ts`](src/file-serve.ts) 拥有包含性解析器、扩展白名单与流式响应。
- [`src/trash.ts`](src/trash.ts) 拥有两种删除：按 id 前缀发现项目工件，以及一个计划素材连同它记录的图片，未被共享的文件移进 `video-trash`，计划则在不含该素材的情况下重写。其他计划的素材或分镜直接引用、同一计划保留的素材或分镜，以及项目资产库仍引用的文件保留原位。删除素材时，回收目录也会保存原计划；写入失败会恢复已移动的文件。其他引用文档无法读取时，删除会失败，因为无法确认其中的素材引用。
- [`src/index.ts`](src/index.ts) 经 `ctx.effect` 把四条路由注册到 Connection 的精确 Fetch 注册表，路由行的存活期与插件一致。

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

- **只支持单区间。** 文件路由应答一个 `bytes=` 区间（206，带 `Content-Range` 与 `Accept-Ranges`），区间越过文件末尾时返回 416；多区间请求回退为整文件。桌面端的 app scheme 载体在交给媒体元素之前会缓冲整个响应，因此那边的播放要等下载完成才开始。
- **未与正在生成的任务协调。** 仅在渲染任务结束后删除项目；运行中的生成器可能在删除后重新写出文件。
- **没有分页或推送。** 列表每次请求扫描全部 `plans/*.json`；大目录的自然扩展是路由加 `?since=` 查询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

路由经 `ctx.effect` 注册到 Connection 的精确 Fetch 注册表，行存活期与插件一致；只注册在 web-server 上的路由能应答浏览器，却永远应答不了桌面外壳——后者把 `/api` 走同一张注册表分发。文件服务的包含性检查顺序是：段白名单 → 扩展白名单 → `realpath` 双端解析 → `relative` 复查；调整任何一步前先读 `tests/workbench.spec.ts` 里对应的拒绝用例，载体分发读 `tests/transport.spec.ts`。双语对的 ToC 锚点必须保持英文 slug，两侧链接才会一致。

</details>
