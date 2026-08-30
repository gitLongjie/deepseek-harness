---
description: "面向侧栏与会话首屏的官方 DeepSeek Harness 品牌填充，仅在官方构建中生效；供选择或替换品牌呈现的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

## 概述

本包向浏览器品牌槽位——`sidebar.brand.mark`、`sidebar.brand.name` 与 `conversation.hero.brand.mark`——填充构建时选定的产品名称与图标。`official` 构建或 [`oem.config.json`](../../../oem.config.json) 提供投影品牌名称时都会注册这些填充。部署只需修改该文件及其引用的公开图片，无需替换槽位包。它不保留任何运行时状态，也不向模型请求贡献任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在浏览器名单中挂载本插件，在 [`oem.config.json`](../../../oem.config.json) 中设置 `productName` 与 `brandIcon`，然后执行普通客户端构建。

### 选择 profile

构建会把 `productName` 投影为 `DSH_CLIENT_BRAND_NAME`，把 `brandIcon` 投影为 `DSH_CLIENT_BRAND_ICON`，供侧栏、Hero、登录卡片与无框架启动页共同使用。显式环境变量可为单次构建覆盖 JSON 字段。既不是 official profile、也没有投影品牌名称的构建仍会加载插件，但保持槽位为空。

### 替换品牌

自有身份的部署不组合本包，而是组合另一个占据相同三个槽位的包。占据槽位是唯一的组合路径；这里不存在任何品牌配置面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

三个填充作为一组声明感知的注册安装：嵌套的 `ctx.slots.inject()` 调用等待侧栏与会话声明，因此无论本行在声明者之前还是之后激活，这组注册都能工作；任一声明消失时全部三个填充一并撤回，HMR 期间也不会留下残缺的品牌混合。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空 Loader 座位。浏览器标题是构建环境的事（`DSH_CLIENT_TITLE`），不在槽位系统之内。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时阅读以下页面。它们从本包占据的槽位进入渲染这些槽位的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md)——在首屏声明 `conversation.hero.brand.mark`。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了品牌呈现的供给方式。它们是当前包约束，不是品牌设计对比或任务积压。

- **只有一组填充**——替代呈现属于占据相同槽位的另一个 Cordis 包。
- **浏览器标题独立渲染**——同一 OEM 产品名称会投影为 `DSH_CLIENT_TITLE`，但 document title 仍不经过 UI 槽位系统。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
