# Agent Note：Provider 卡片渲染适配器声明的家族

状态：已实现

[English](2026-09-03-provider-editor-family-declaration.md) | 中文

## 问题

设置里的模型页把 Deepagens 的 provider 卡片渲染成「未知布局」——只剩"请直接编辑 settings.yaml 对应段"的提示，既没有 API 密钥输入框，也看不到登录流程已写入的 30 个网关模型。编辑器从一张硬编码的命名空间表（`llm-deepseek`、`llm-pi-ai`）挑选卡片，因此任何共享 DeepSeek 段结构的第二个适配器路由，一旦有了自己的命名空间 id，就落在了所有精选卡片之外。

## 决策

configurable-provider 目录条目携带卡片家族：`LlmConfigurableProvider.editorFamily`，由所属适配器插件声明（`llm-deepseek` 为它的两条路由声明 `deepseek`，`llm-pi-ai` 声明 `pi-ai`）。模型页把该声明穿过目录合并传给 `ProviderEditor`，后者将其窄化为自己手写的布局；适配器未声明家族的路由渲染进阶字段提示。命名空间 id 不再是布局的输入。

## 被否决的替代方案

**把 `llm-deepagens` 加进 UI 的命名空间表。** 否决：只治一个症状，还种下下一个——未来每个适配器命名空间都需要一次 UI 提交才能变得可编辑，且失败模式依然无声：一张只渲染提示的卡片。

**从 section schema 的形状推导家族。** 否决：形状答案是启发式（两个家族可能重叠，某一个还可能变化），而适配器本来就知道哪个编辑器匹配自己的 config；声明才是事实，不需要重新推导的猜测。

## 后果

Deepagens 卡片现在渲染 deepseek 家族编辑器——API 密钥、base URL 和网关种子的模型列表——其目录变化时无需任何 UI 改动。新的适配器命名空间在其插件声明家族之前渲染提示，让"忘了声明"可见，而不是无声地不可编辑。
