# Agent Note: cwd 提示词变量回归，归属 working-directory 服务

Status: implemented

[English](2026-11-03-cwd-prompt-variable.md) | 中文

## 问题

上游 v0.2.1-alpha.1 发布移除了 agent loop 内建的 `{{cwd}}` 提示词变量（[升级指南](../../../../docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.zh.md)）：它读取 `Session.header.cwd`（原始项目目录），因此已用 `working_directory({ cd })` 切换目录的 Session 仍会插值出旧路径，而且目录本身已经作为必需用户上下文送达模型。保留该引用的模板从此在装配期失败并报 `unknown prompt variable "{{cwd}}"`，这是设计好的 fail-loud 行为。

随产品发布的专家预设写于该移除之后，但其 persona 前缀仍保留目录从句——`工作目录是 {{cwd}}。`——并注释称该变量从 agent 的工作区解析。OEM 桌面里运行任一此类专家都会在任何模型请求之前失败，因为已没有任何地方注册 `cwd`。

## 决定

`cwd` 提示词变量回归，改由 working-directory 服务——生效目录的归属方——注册，而不是 agent loop。provider 解析 Session 的**生效**目录（投影状态，包含已提交的 `cd` 变更与恢复），不是 `header.cwd`：促成上游移除的误导性语义不再回来，且取值跟随同一 Session 内的目录变化。没有 Agent 的装配使该变量无值，在该处引用它的模板仍会严格失败，与其他提示词变量一致。

本决定有意偏离升级指南的迁移建议（删掉从句、依赖用户上下文）：随发布的专家 persona 把该从句当作身份叙述使用，严格失败的装配会把这段叙述变成运行失败。不引用 `{{cwd}}` 的 persona 不受影响；working-directory 上下文小节仍是模型可见目录的权威陈述。

## 备选方案

**只改预设。** 从专家 persona 中删除 `{{cwd}}` 从句符合升级指南并消除运行时依赖，但模板散布在各 OEM 线的已发布预设目录里，未来每个 persona 作者都会踩中预设已经踩过的隐性陷阱。注册变量使模板文档契约（“`{{model}}` 和 `{{cwd}}` 从 agent 自己的路由和工作区解析”）成为事实。

**在 agent loop 重新注册。** loop 不是目录归属方，也拿不到生效目录投影；在那里注册要么重新引入 `header.cwd` 语义，要么重复读取投影。working-directory 服务本就通过其上下文贡献参与每一次装配。

## 后果

- 专家与 persona 模板可再次插值 `{{cwd}}`；取值是装配时的生效目录，可能与 `Session.header.cwd` 不同。
- 无 Agent 的装配上该变量缺席；在该处引用它的模板严格失败。
- [working-directory 升级指南](../../../../docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.zh.md)保留为 loop 侧移除的历史记录；working-directory README 记载服务侧变量。
