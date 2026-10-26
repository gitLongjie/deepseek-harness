# Agent Note: 组合层之上的用户可编辑 H3 视频设置

Status: implemented

[English](2026-10-03-h3-video-user-settings.md) | 中文

## Problem

H3 视频的每个可调项——ComfyUI 地址与工作流模板、MiniMax 接口与模型、轮询间隔、并发上限、输出目录、磁盘预检参数——只存在于预设的组合文件里。改任何一项都要手工编辑 `~/.dsh/.agent-presets/` 下的 YAML，而桌面端对此没有任何界面：想调本地后端或粘贴托管 API key 的人从界面上无从下手，一次错误的 YAML 编辑还可能弄坏整个预设的挂载。

这个 seam 本来就有分层的概念——每个部署一份组合基座——但没有用户层，也没有宿主面所有者。`settings.register` 是每进程一次的所有权注册，所以命名空间不能由预设内挂载的服务来注册（第二个会话挂载同一预设就会在注册上相撞，而且命名空间会随挂载生灭）。

## Decision

沿现有 seam 做三段拆分：

- **宿主入口**（`@deepseek-ai/dsh-h3-video/settings`，web-app bundle 的一行）：在扁平、全可选的 schema（`comfyUrl`、`comfyWorkflowPath`、`minimaxApiKeyRef`、`outputDir`、`minFreeSpaceMb`……）上注册 `h3-video` 设置命名空间，并把实时分节发布为宿主面服务 `h3VideoSettings`。设置界面的工作不依赖任何预设是否挂载；视图比会话活得久。
- **预设内服务**：`LocalH3Video` 经导出的 `resolveOverlayConfig(base, section)` 解析生效配置——存在且非空的设置生效，缺席的沿用组合值，两个后端锚点也随覆盖传递（`comfyWorkflowPath` 启用本地，`minimaxApiKeyRef` 启用远端）——并在每次提交变化时经 `view.watch` 重建后端。服务解析像 `credentials` 一样穿过预设的 `h3Video` isolate realm；scope 句柄做不到这一点，这正是视图以服务形态存在的原因。
- **客户端卡片**（`ui-settings-plugins`，按命名空间作 key）：整个命名空间一张卡——插件配置 tab 按每个被服务命名空间派发一张卡，所以分组以卡内有序字段（本地、远端、输出）呈现，而不是多张卡。MiniMax 密钥沿用 web-search 先例：随表单暂存，通过凭据域按分节引用的名称写入，绝不存进设置文档。

覆盖层刻意扁平：设置卡是扁平表单，扁平名与组合 `comfy`/`minimax` 行唯一交汇处就是导出的 resolve 步骤——一个显式边界，而不是散落的 `??` 链。

## Alternatives considered

- **由预设内挂载的服务注册命名空间。** 拒绝：第二个会话挂载同一预设时重复注册抛错，且命名空间随最后一个挂载消失。
- **设置界面直接编辑预设的组合文件。** 拒绝：组合是被 roster 健康检查、被挂载原样消费的文件；UI 写 YAML 是第二条作者路径，却没有设置文档已有的暂存、校验和 revision 栅栏。
- **重新启用宿主面引擎并在那里配置。** 拒绝：服务行按设计属于预设面（每会话隔离）；只有设置命名空间在宿主面，由视图服务把它带进 realm。
- **一个命名空间多张卡（每后端一张）。** 拒绝：tab 按槽位 key 一命名空间一卡配对；给 key 加后缀会破坏派发，一张卡内有序字段能达成同样的分组而不引入第二种台账约定。

## Consequences

- 插件设置页端到端编辑 H3 视频配置；提交的变化无需重启会话即达已挂载服务，也经构造器的初次 resolve 到达下一次挂载。
- 没有后端锚点的组合从此合法：它只在设置启用一个后端之前于加载时失败，"至少一个后端"规则从仅加载期变为可实时编辑的状态。
- `resolveOverlayConfig` 是唯一的映射表；schema 新增的字段要么经过它，要么不存在。扁平词汇由客户端自行拼写（客户端包不得依赖宿主包），两套拼写靠本 note 与测试在同一 PR 里同步移动。
