# Agent Note：专家市场自带精选名单

Status: implemented

[English](2026-09-13-expert-market-ships-its-own-roster.md) | 中文

## 问题

专家页最初渲染部署的 agent-preset 名单，经宿主的 `agentPresets` Remote face 读取。于是每个已组装的 preset 都以可聘用专家卡片出现，包括标准模式这类模式 preset——它们是会话组装选项，不是市场页上的商品。远程读取还让页面内容带上三条回退路径（invocation-unavailable、部署名单为空、inject 未接线），全都回答 mock 数据：页面展示什么取决于部署的组装与失败行为，而不是一个确定的目录。

## 决策

专家市场的内容是 `ui-expert` 自带的精选名单（`src/client/mock-data.ts` 的 `MOCK_EXPERT_PRESETS`）：特色场景横幅加多个分类的可聘用专家卡片。页面 inject 不再声明 `remote` 与 `remote.agentPresets`，`load` 直接回答这份名单，包同时移除 `@deepseek-ai/dsh-api-remotes` 的依赖、devDependency 与 tsconfig reference。聘用不变：把卡片的 preset id 转发给 ui-agent-preset 暂存服务并启动下一个会话。此项取代[专家卡片元数据决策](2026-09-13-expert-card-metadata-on-agent-presets.zh.md)的消费半边：`preset.yml` 卡片字段仍流经 discovery、Remote 投影与创作副本，但名单归 preset 面板所有，市场不再渲染它。把市场接到部署管理的 registry，随市场安装通道及其信任层级一起回归。

## 考虑过的替代方案

**保留 Remote 名单并过滤掉模式 preset。** 否决：部署可组装任意 preset，且没有字段能区分可聘用专家与模式 preset，任何启发式（默认标记、元数据有无）都会在某类部署上出错，三条回退路径也仍然存在。

**让市场保持为空，直到真实 registry 出现。** 否决：这个页面存在的意义就是端到端演练市场体验——浏览、筛选、聘用——永远为空的目录让这些流程失去依托。

## 验证

`apply.client.spec.tsx` 断言 `load` 回答自带名单、聘用在会话启动前先暂存转发的 id；Remote stub 已删除，包清单不再声明 `@deepseek-ai/dsh-api-remotes` 依赖。

## 后果

所有部署渲染同一份确定的目录，没有远程读取，也没有回退分支；页面空态在 registry 取代自带名单之前不可达。
