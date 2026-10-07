---
description: "视频工作台页面：侧栏面板行与 h3-video 输出目录上的项目目录页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-video-workbench

[English](README.md) | 中文

## 概述

本包是视频工作台的浏览器半边：侧栏的一个全局面板行（id `video-workbench`，排在定时任务行旁边）与对应的 `main` 页面。页面列出宿主路由报告的视频项目——目标、模式、版本、逐镜头渲染状态——并在选中项目下展示关键帧缩略图与成片 `<video>` 播放。数据来自 [`@deepseek-ai/dsh-video-workbench`](../../video/video-workbench/README.zh.md) 的只读路由；本包除选择与刷新外不持有状态。

## 目录

- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与遗留工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="understand-the-implementation"></a>
## 理解实现

- [`src/client/index.ts`](src/client/index.ts) 在槽位声明上账后注册 `sidebar.panellist` 行与 keyed `main` 条目，并把页面注入的加载器绑定到同源的项目列表路由。
- [`src/client/VideoWorkbenchPage.tsx`](src/client/VideoWorkbenchPage.tsx) 渲染目录与详情两栏；列表在打开时、每 10 秒以及点击刷新按钮时刷新。媒体 URL 经宿主文件路由，并剥去投影根前缀。
- 所有文案经 `videoWorkbench` 字典命名空间由 locale 持有（[`src/client/locales.ts`](src/client/locales.ts)）。

**运行时不变量：** 不发布 companion。页面只持有自身的选择与最近一次拉取的列表，二者都是 React 局部状态，因此没有跨包边界、可供 companion 观察的拥有关系。

<a id="model-experience"></a>
## Model Experience

### Model-facing contract

#### What the model sees

什么都看不到。页面不注册工具、不写会话状态；渲染停留在浏览器内，注入的加载器只调用 `loadSummary()` 一次封装的同源请求。

#### Token effect

无影响：页面从不进入模型请求或会话记录。

#### KV Cache effect

无影响：本包不添加系统提示文本，也没有逐请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

<a id="已知限制与遗留工作"></a>

- **页内没有重渲染或编辑动作。** 工作台是只读投影；渲染走带确认门的 `/video` 流程。
- **媒体整段缓冲。** 关键帧与成片整文件加载；宿主文件路由暂无字节区间应答。
- **experimental 原型、无稳定性承诺** —— 包是公开的，孵化期间槽位与文案可自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`main` 槽的 `inject` 是工厂（`() => injected`），槽位运行时会把返回值与 `t` 一起摊平进页面 props——传对象而不是工厂会通过不了类型。媒体 URL 一律经 `workbenchFileUrl`（剥投影根 + 反斜杠归一），不要在组件里手拼 `?path=`。双语对的 ToC 锚点保持英文 slug。

</details>
