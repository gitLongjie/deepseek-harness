# Agent Note：恢复被 dsh 0.1.6-alpha.1 合并丢弃的适配器声明编辑器家族

Status: implemented

[English](2026-09-17-models-editor-family-merge-drop.md) | 中文

## 问题

合并上游 dsh 0.1.6-alpha.1（bb1a3b16bb）时丢失了声明式编辑器家族（921b4e1213 引入）的客户端一侧：`ProviderDirectoryEntry` 丢失了 `editorFamily` 字段，`joinProviderDirectory` 不再从 `LlmConfigurableProvider` 拷贝它，`targetOf` 也不再把它传给 `ProviderEditor`。适配器（`llm-deepseek`、`llm-pi-ai`）仍在目录 wire 上声明家族，于是模型设置页的每张卡片都落到 unknown 布局，只渲染"其余字段在 settings.yaml 中"的提示——没有 API 密钥输入框、没有 API 地址、没有模型目录。71 个分区测试以"no customized fold"失败。

## 决策

恢复被丢弃的三处：`ProviderDirectoryEntry` 上的 `editorFamily` 字段、`joinProviderDirectory` 中的拷贝（`packages/client/ui-settings-models/src/client/store.ts`）、`targetOf` 中的透传（`packages/client/ui-settings-models/src/client/ModelsSection.tsx`）。三个早于声明式设计的上游测试夹具脚本化的目录应答缺少 `editorFamily`，现按真实适配器声明的家族补齐；不带家族直接挂载 `ProviderEditor` 的用例继续断言提示文案。

## 已考虑的替代方案

**采用上游按命名空间 ID 推断**（客户端内 `llm-pi-ai` → pi-ai）。声明式家族设计正是为了让新适配器命名空间通过声明家族获得 curated 卡片，而不是在客户端硬编码；wire 类型、宿主侧校验和两个适配器在合并中都保留了该设计，因此只需恢复客户端消费。

## 影响

在模型设置页编辑提供方重新打开其 curated 可视化卡片——密钥、API 地址、声明路由的显示名称与协议、以及带发现的模型目录。适配器未声明家族的命名空间仍渲染 settings.yaml 提示卡片。按推断设计脚本化的上游测试夹具现改为声明式设计的夹具；未来新命名空间必须在目录条目上声明家族才能获得 curated 卡片。
