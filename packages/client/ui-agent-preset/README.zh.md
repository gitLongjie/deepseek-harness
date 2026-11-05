---
description: "为下一次任务显示专家名称，并打开专家页设置新任务默认值。创建与修改引导至创造专家。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

[English](README.md) | 中文

## 概述

为下一次任务显示专家名称，并打开专家页设置新任务默认值。创建与修改引导至创造专家。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

新会话芯片显示下一次任务将使用的专家。点击它打开专家页。聘用一张卡片会以该预设开始对话。健康卡片上的「设为新任务默认」写入默认值，并应用到当前新任务界面的空白会话。设置里没有 Agent 预设分区。失效的专家仍留在页面上，不能聘用，也不能存成默认值。

关闭代码工作工具时，沿用现有 Developer tools 订阅清空尚未应用的选择。关闭状态被接受后，每个已认证浏览器都会把已保存的内置 PTC 或极简默认值回退为标准专家。已保存的标准、创造和自定义默认值保持不变。已有会话保留自己的预设；新会话使用当前默认值。重新开启代码工作工具不会恢复原来的默认值。标准专家缺失或损坏时，默认值保持不变。

插件页**添加插件**菜单中的**让 Agent 创建插件**进入创造专家。它不发送消息，并保留未发送的草稿。读取预设列表或创造专家不可用时，菜单项禁用并说明原因。Host 拒绝切换预设时，通过 Toast 显示原因。

进入创造专家会为接收该选择的空白 Session 选择 `cordis`，不改变新任务默认值或代码工作工具设置。尚未绑定工作区或空白 Session 时，选择等待绑定完成后应用。应用后，创造 Session 保留该预设；之后真正创建的新 Session 使用配置的默认值，例如标准专家。

在桌面端，模式选择器中的直接选择切换到另一个内置 preset 时，可选的[产品埋点](../product-analytics/README.zh.md)服务会收到 `agent_preset_switch`：未绑定 Session 的选择在暂存给下一个 Session 时计入，已绑定空白 Session 的选择在 Host 应用后计入。事件携带按 preset id 映射的来源与目标类别（`cordis` 记为 `creator`；`ptc`、`minimal`、`standard` 保持原 id；其他 id 记为 `other`），以及选择时已知的代码工作工具设置。选择自定义目标、被拒绝的选择、Host 最终落在其他 preset 的选择、默认值修改及其空白 Session 同步均不报告；来源模式或代码工作工具设置未知时做出的选择同样不报告。不采集自定义 preset 的 id 和名称。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`agentPresets/list` 提供列表并标记当前默认值。专家页把新任务默认值写入 `agent-preset-registry` settings 命名空间，并同步当前空白会话。芯片和只读会话标签使用记录的 preset 标识。连接重置和设置更新会刷新列表。

`CreatePluginMenuItem` 使用共享的预设列表 store，向 `plugins.add.actions` 贡献菜单项。选择时先调用页面传入的 `onDismiss()`，再调用 `startCreatorDraft`。该回调通过 `AgentPresetSeatController` 暂存 `cordis`（主区空白 Session 列出其他 preset 时不暂存，因为导航会打开另一个空白 Session，原空白 Session 保持不变），再通过显式保留草稿并传入 `agentPreset: 'cordis'` 的 `uiWorkspace.startSession` 调用打开任务，由 Host 以创造专家组合被复用的空白 Session 或新 Session；没有目标工作区时，暂存选择在 Session 绑定可用时应用。暂存选择应用后即清除。`AgentPresetSeat` 通过共享的 `Toast` 组件显示拒绝原因。

`AgentPresetSeatController.select()` 与 `apply()` 返回本次尝试的结果：Host 提交暂存 preset 时为 `applied`；没有当前 Session 时为 `staged`；忙碌、没有暂存选择、Session 已开始或已使用该 preset，或 Host 最终落在其他 preset 时为 `unchanged`；Host 拒绝时为携带原始原因的 `refused`。选择器注入的 `select` 根据该结果报告 `agent_preset_switch`，并且只返回拒绝原因。

工作区的空白会话就是它的「新会话」占位会话，并被多个流程共享：聘用会把专家组装进它，而下一个新会话流程又会接管同一个会话。`bindPlaceholderAdoption` 就是本包恢复「新建会话会解析出的那个组装」的地方——但只在当前组装已经无法装配时才恢复。携带健康预设的占位会话会保持不动；已暂存的选择会立即返回，因为把会话切换到它是 applier 的职责。只有已经无法装配的组装（预设被删除或损坏）才回退到默认值。名称解析读取同一份健康名单，因此运行任何预设的会话都由该预设命名。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Scope](../../core/scope/README.zh.md) — 注册隔离。
- [Agent](../../core/agent/README.zh.md) — 会话运行时。
- [Cordis](../../../docs/cordis-primer.zh.md) — 插件配置与生命周期。

<a id="model-experience"></a>
## 模型体验

通过选定的 preset 间接影响模型，其插件拥有模型可见能力。

#### KV Cache effect

选择变更只影响之后的任务，已有插件与提示词保持不变。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- Web 不创建也不编辑 preset：配置查看器是只读的；通过创造专家安装的 bundle 声明新 preset，或按行 id 覆盖内置 preset，覆盖会替换整个子插件列表。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
