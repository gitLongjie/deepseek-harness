# Agent Note: Login adopts the first gateway model as the default

Status: implemented

[English](2026-09-23-login-adopts-first-gateway-model-as-default.md) | 中文

## 问题

全新安装组合出的默认 Agent 模型是静态 DeepSeek 路由（`deepseek-official` / `deepseek-flash`，base bundle 的 `agent-default-model` 行）。Deepagens 桌面端从不服务该路由：账号会话携带的是网关密钥，可用模型是登录流程拉取进 `llm-deepagens` 的那批。只要用户没有手动选择过模型，每个新会话都从一个无法服务的默认值启动——模型选择器展示的默认项账号根本跑不了。

## 决策

登录 store 的网关同步现在同时负责默认模型采纳。发现结果列出模型后，它从保护目录写入的同一个 settings describe 里读取 `agent-default-model` 描述符；当当前选择不是拉取目录所含模型时，按描述符的 revision 将该命名空间的用户层整体替换为 `{ provider: 'deepagens', model: <第一个拉取的 id> }`。采纳在每次成功发现后都会运行，包括目录未变化路径，因此此前默认写入失败的安装会在下次登录时自愈。

守卫刻意区分提供商：只有提供商是网关路由且模型 id 出现在拉取目录中，该选择才算被服务。同 id 的其他路由模型不满足条件，采纳会重新指向。空发现、命名空间缺失、写入被拒或 revision 冲突都保留原默认值并记录拒绝日志；这些都不会导致登录失败。

## 已考虑的替代方案

**把组合条目改成网关路由。** bundle 在任何登录之前组合完成，无法得知拉取的模型 id；带空目录的网关提供商条目会让会话在首次登录之前（而不是之后）失败。

**每次都用第一个拉取模型覆盖。** 网关目录变化时的每次重新登录都会把用户的主动选择重置回第一个模型；守卫只为安装场景保留这一种行为，且无需付出该代价。

**在 Host 侧于种子目录落盘时采纳。** Host 无法把登录播种的目录写入与用户对同一命名空间的编辑区分开，决策将需要在 settings 接缝上新增信号；而客户端在采纳时刻已经同时握有两个事实——拉取列表与描述符。

**会话创建时默认不可路由则静默回退。** 解析时静默回退会掩盖默认值本应暴露的错配，且与组合 fail-loud 原则冲突；采纳改为在已知全新默认值的源头一次性修正存储的事实。

## 后果

全新安装的首次登录以可用默认值收尾，存量安装在下一次登录时收敛。刻意选择网关不服务模型的用户会在下一次登录时失去该选择——可接受，因为网关模型才是账号会话能运行的路由。`replace` 会连同被覆盖的选择一起丢弃已存储的 `reasoningEffort`；下次手动选择会恢复它。

## 测试

`packages/client/ui-login/tests/login-models.client.spec.ts` 固定以下行为：目录未变化下的采纳、已服务默认值的保留（含已存 `reasoningEffort`）、同 id 其他路由的重新指向、写入被拒时登录存活、空发现跳过、发现被拒跳过，以及带 revision 的精确 `replace` 载荷。
