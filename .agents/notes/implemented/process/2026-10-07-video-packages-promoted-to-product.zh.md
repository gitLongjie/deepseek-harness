# Agent Note: 将视频包晋级到产品角色分组

Status: implemented

[English](2026-10-07-video-packages-promoted-to-product.md) | 中文

## 问题

H3 视频能力以三个 `packages/experimental/` 包发布，而随产品发布的桌面端与 Web 组合却依赖这三者。[默认产品隔离门禁](../../../../scripts/verify-default-product-isolation.ts)拒绝的正是这种情形：实验性包不得出现在默认产品的依赖、运行时导入或随产品发布的组合中。该门禁报出九条视频相关违规——`apps/desktop` 两行依赖、`packages/bundle/web-app` 两行依赖，以及两行 bundle patch，涉及 `h3-video`、`tool-video` 与 `video-workbench`——因此桌面端构建对一个它刻意随产品发布的能力长期处于红灯。

[实验子树规则](../../../../packages/experimental/AGENTS.md)给出了受认可的解法：发布产品需要的包晋级到产品角色分组，并去掉 `experimental-` npm 前缀。

## 决策

三个包迁入新的 `packages/video/` 分组并去掉前缀：

| 之前 | 之后 |
|---|---|
| `packages/experimental/h3-video` —— `@deepseek-ai/dsh-experimental-h3-video` | `packages/video/h3-video` —— `@deepseek-ai/dsh-h3-video` |
| `packages/experimental/tool-video` —— `@deepseek-ai/dsh-experimental-tool-video` | `packages/video/tool-video` —— `@deepseek-ai/dsh-tool-video` |
| `packages/experimental/video-workbench` —— `@deepseek-ai/dsh-experimental-video-workbench` | `packages/video/video-workbench` —— `@deepseek-ai/dsh-video-workbench` |

`./settings` 子路径保持原形，即 `@deepseek-ai/dsh-h3-video/settings`。浏览器半边留在原处 `packages/client/ui-video-workbench`（它从未带实验性前缀，因为隔离门禁只拒绝前缀）。所有 import、`tsconfig` paths 与 project references、bundle patch 行与依赖行在同一次改动中一起迁移，因此不存在解析到半改名包的中间状态。

晋级使本组的规则即产品规则。实验性状态曾豁免的四项义务现在生效，并在本次改动中一并满足：

- **完整的服务 JSDoc。** Cordis 目录要求每个被文档化的服务方法带 `@param`/`@returns`；`h3Video.capabilities`、`canServe`、`poll`、`assemble` 与 `h3VideoSettings.get` 补上了缺失标签。
- **boot manifest 条目。** `gen-tool-catalog` 会 glob `packages/*/tool-*`，对任何无法编目的工具包报错；`tool-video` 从未登记，因此该生成器自该包落地起一直失败。现在它有了 `TOOL_PACKAGES` 条目，用一个占位本地后端挂载接口——因为 schema 采集从不提交渲染。
- **类型链接归类。** 服务签名中的每个类型都要为 Cordis 目录归类；十个视频类型豁免到 `h3-video` 包 README，与策略对其他服务包已使用的"非目录归属者"形态一致。
- **明确的不变量姿态。** 两个工作台 README 都写上了不变量门禁对省略 companion 的包所要求的 `No … companion is published` 理由句。

本组暂无 `docs/subsystems/` 页面。它改为携带一条有理由的 [`GROUPS_WITHOUT_SUBSYSTEM_PAGE`](../../../../scripts/verify-subsystem-pages.ts) 豁免：`ctx.h3Video` 的契约——配置、路由、provider 能力——由 `h3-video` 包 README 承载，且没有任何类型的归属在该包之外。subsystem 参考页推迟到有类型需要它时再补。

## 曾考虑的替代方案

**保持实验性并把它们从默认产品中移除。** 这会通过把该能力从随产品发布的桌面端与 Web 组合中删除来满足门禁，而这与那些组合存在的目的正好相反。

**为这三个包放宽隔离门禁。** 该门禁编码的是"实验性包不提供稳定性承诺"这一规则；一处例外会把一个无承诺的能力放进默认产品，并为今后每个包削弱该规则。

**迁入既有产品分组而不是新建 `video/`。** `tool-video` 本可与其他模型面向工具包放在一起，但接口、其消费者与工作台投影是同一个能力家族，共享一个输出目录与生命周期；把它们拆到不同分组会让同一份契约散落。新建分组只多付一对 README 与一行表格。

**现在就创建 `docs/subsystems/video.md`。** 推迟而非否决：接口契约目前完整写在它的包 README 中，而 subsystem 页面会在还没有任何类型需要在包外安家时先复述一遍。本组 README 的开发备注记录了该推迟。

## 后果

- 默认产品隔离门禁失去全部九条视频违规，只剩既有的 `webworker-runtime` 一行。
- 这些包现在带有稳定 API 预期。按[晋级规则](../../../../packages/experimental/AGENTS.md)，该审查包含**一位接受稳定包义务的具名 owner**；本次改动完成机械晋级，本身并不指定该 owner。
- 新增本组 README 及其中文对照，以及包总表中的一行 `video/`；实验分组 README 从未列出这三个包，因此无需删除。
- 生成物随改名跟进：config 目录、依赖目录、模块图与工具目录均已重新生成，根 `node_modules` 的插件链接也重新指向新目录。
