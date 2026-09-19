# Agent Note：将 Deepagens 网关路由固定为其 seed 的 /v1 上的 chat completions

Status: implemented

[English](2026-09-17-deepagens-chat-completions-default.md) | 中文

## 问题

通过 Deepagens 提供方生成时，每个请求都以网关 404 失败：`Invalid URL (POST /v1/v1/messages)`。该路由的设置段安装共享的 `llm-deepseek` Config schema，其 `protocol` 默认为 `messages`；登录流程向该命名空间写入的 `baseURL` 以 `<origin>/v1` 结尾；而 Messages 传输 POST `{baseURL}/v1/messages`。重复的 `/v1` 打到了一个只提供 chat completions 的网关上。模型发现保持绿色，因为它 GET `{baseURL}/models`，缺陷只在生成时暴露；且模型编辑器的 Deepagens 卡片不提供协议控件，用户无法从界面恢复。

## 决策

`llm-deepagens` 的组合 base——`packages/llm/llm-deepseek/src/index.ts` 中 `installSection` 的条目——携带 `protocol: 'chat-completions'`。base 解析在用户层之下、schema 默认之上，因此早先登录存储、从不包含 `protocol` 的设置段无需任何迁移即解析为 chat completions，显式存储的协议仍然胜出。登录流程继续只写 `baseURL` 与 `models`：线上协议只有一处事实来源，即组合 base。

## 已考虑的替代方案

**由登录变更写入 `protocol: 'chat-completions'`。** 只能修复未来的登录，且用户层取值位于此后任何组合默认值之上，路由协议的后续纠正永远到不了被固定的用户；同一事实会存在于两层。

**用 Deepagens 专属 schema 强制协议（`z.const('chat-completions')`）。** `z.const` 拒绝其他一切取值，存储的 `protocol: 'messages'` 会使整个设置段校验失败，命名空间困在最后一份良好快照上而非自愈。

**在 Messages 传输里裁掉结尾的 `/v1`。** 路径手术掩盖一个不匹配的后缀，同时两个命名空间仍停留在网关不提供的协议上；协议而非 URL 文本才是归属事实。

## 影响

Deepagens 生成 POST `{baseURL}/chat/completions`，与网关的 OpenAI 兼容面一致，目录发现与生成指向同一路径。`packages/llm/llm-deepseek/tests/dynamic-config.spec.ts` 通过 seed 的 `/v1` base URL 与一次组装请求把 wire 路径 `/v1/chat/completions` 钉住，对旧默认值失败。若网关未来提供 Anthropic 兼容面，显式的用户层 `protocol: 'messages'` 即可选中——分层让这一点无需改码即可达。
