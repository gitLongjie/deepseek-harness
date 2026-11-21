---
description: "dsh Web 客户端的专家中心插件：一条侧边栏入口行，打开把部署的专家市场呈现为可聘用专家卡片的会话区页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-expert

[English](README.md) | 中文

## 概述

`dsh-client-ui-expert` 是 dsh Web 客户端的专家中心：知识库与业务入口区域之间的一条侧边栏入口打开会话区里的专家市场，呈现为可聘用的卡片，每张带有头像、副标题、策展徽标、描述与标签。卡片支持文本搜索、由记录元数据供数的分类筛选栏、推荐提问与聘用动作。聘用经 ui-agent-preset 舞台服务为下一个会话暂存 preset id 并启动该会话。市场收录发布卡片元数据的名单行；随附预设发布 `category: general`。general、marketing、content 的筛选芯片使用本包词典；其他 id 按撰写原文显示。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 默认挂载本插件；移除该行即可关闭此界面。侧边栏入口行随之消失——外壳把未被占用的洞渲染为空。

```yaml
- id: ui-expert
  name: '@deepseek-ai/dsh-client-ui-expert'
```

### Minimal configuration

自身没有配置：页面渲染部署随附的名单——发布卡片元数据的 preset 以可聘用专家呈现，名单其余部分不会出现。页面有两个模块。我的专家是这份名单：每张卡片打开详情，展示描述、人设和技能标题，并显示本机保存的版本。本账号在本机保存的卡片，以及从 `.agent-presets` 之外加载的系统自带专家，可以上传。本机版本已经和已发布版本一致时，卡片显示已是最新，不再报一次上传成功。卡片会显示上传已经完成，或说明停下来的原因。健康卡片可以聘用到新对话，或存为新任务默认。从广场安装的卡片，在已发布版本更高时可以更新。专家广场列出网关上已发布的模块：每张卡片显示版本，未安装的可以下载，已安装且已发布版本更高时可以更新。本账号已经从本机专家发布出去的模块显示该版本，不再提供另一次下载。从广场安装之后才出现聘用。新会话芯片打开这个页面。默认卡片显示该徽标。

### What can go wrong

分区注册进外壳声明的 `sidebar.experts` 洞，页面注册进 ui-conversation 的 `conversation.expert.browser` 洞；移除任一声明会让注册处于等待、界面缺席，这正是空插槽的文档化行为。在没有会话流绑定时聘用不会暂存任何内容：舞台服务在没有座位接收选择时按空操作处理，页面仍会以部署默认值启动会话。

宿主报告为 broken（组装无法挂载）的名单行仍会在页面上保留卡片，聘用和设为新任务默认都不可用，并展示健康结论：市场是唯一宣传该专家的界面，这里的错误配置会如实呈报，而不是聘用后陷入无提示的失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

两个 slot 注册加一个导航服务：`ExpertNav` 填充 `sidebar.experts`，`ExpertBrowser` 填充 `conversation.expert.browser`，`UiExpertService` 持有页面状态并沿用知识库页面的随会话关闭策略。聘用经由 `uiAgentPreset` 服务（先舞台后启动会话，镜像设置区创作入口的顺序）完成暂存，并经 Workspace UI 的共享动作启动会话。

| File | Owns |
|---|---|
| `src/client/index.ts` | 两个 slot 注册、词典与注入工厂 |
| `src/client/ExpertNav.tsx` | 入口行：宽行与轨道图标，页面站立时高亮 |
| `src/client/ExpertBrowser.tsx` | 页面：我的专家与专家广场、搜索、分类筛选、卡片网格、聘用、状态 |
| `src/client/navigation.ts` | 页面 store 与随会话关闭的监听 |
| `src/client/contract/slots.ts` | 注入 share 与 props 组合 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-agent-presets`](../../preset/agent-preset-registry/README.zh.md)——专家卡片所参照的 `preset.yml` 元数据字段，以及读取这份名单的 preset 界面。
- [`dsh-client-ui-agent-preset`](../ui-agent-preset/README.zh.md)——本包借以暂存选择的 preset 界面。
- [Slots subsystem](../../../docs/subsystems/slots.zh.md)——本注册使用的洞/占用者模型。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过每次聘用暂存的 preset 起作用：聘用把卡片的 preset id 转发给暂存服务，下一个会话由它组装，宿主把这一选择记录为它自己的 `agent-preset/selected` 会话事件。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **名单驱动的市场**——市场读取部署的 agent-preset 名单；卡片设计预留的署名副标题、策展徽标与头像图片，要等名单随市场安装通道携带它们，当前卡片回退为渐变底色加已发布的字符图标。
- **上传跳过广场安装和包副本**——登录账号自己保存的卡片和系统自带专家可以上传。从广场安装的专家，以及 `.agent-presets` 下的预设，不能上传。收藏与卡片评价仍然延期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
