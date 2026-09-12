---
description: "dsh Web 客户端的专家中心插件：一条侧边栏入口行，打开把部署的 agent-preset 名单呈现为可聘用专家卡片的会话区页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-expert

[English](README.md) | 中文

## 概述

`dsh-client-ui-expert` 是 dsh Web 客户端的专家中心：一条侧边栏入口行（位于知识库与业务入口区域之间）打开会话区页面——把部署的 agent-preset 名单呈现为可聘用的专家卡片，支持按名称、描述与标签的文本搜索，按 `preset.yml` 已发布元数据生成的分类筛选栏，每张卡片的推荐提问，以及每张卡片的聘用动作。聘用通过 ui-agent-preset 的舞台服务为下一个会话暂存该 preset 并启动会话；页面本身只是 `agentPresets` Remote 名单之上的呈现层。

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

自身没有配置：页面通过 `agentPresets.list` 读取名单，不组装任何 preset 的部署会渲染空市场而非错误。卡片只显示健康的 preset——损坏的名单行无法组装聘用将启动的会话，因此绝不会以可聘用的形态出现。

### What can go wrong

分区注册进外壳声明的 `sidebar.experts` 洞，页面注册进 ui-conversation 的 `conversation.expert.browser` 洞；移除任一声明会让注册处于等待、界面缺席，这正是空插槽的文档化行为。在没有会话流绑定时聘用不会暂存任何内容：舞台服务在没有座位接收选择时按空操作处理，页面仍会以部署默认值启动会话。

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
| `src/client/ExpertBrowser.tsx` | 页面：搜索、分类筛选、卡片网格、聘用、状态 |
| `src/client/navigation.ts` | 页面 store 与随会话关闭的监听 |
| `src/client/contract/slots.ts` | 注入 share 与 props 组合 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-agent-presets`](../../preset/agent-presets/README.zh.md)——本页面呈现的名单，以及卡片所展示 `preset.yml` 元数据字段。
- [`dsh-client-ui-agent-preset`](../ui-agent-preset/README.zh.md)——本包借以暂存选择的 preset 界面。
- [Slots subsystem](../../../docs/subsystems/slots.zh.md)——本注册使用的洞/占用者模型。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经由它所呈现的 agent-preset 名单：一次聘用会暂存下一个会话由哪个 preset 组装，而宿主把这一选择记录为它自己的 `agent-preset/selected` 会话事件。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅本地名单**——页面呈现部署已安装的 preset；从远程专家 registry 安装将随市场安装通道及其信任策略一起到来。
- **仅浏览与聘用**——专家创作、收藏与卡片评价延迟到存在可发布它们的 registry 之后再做。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
