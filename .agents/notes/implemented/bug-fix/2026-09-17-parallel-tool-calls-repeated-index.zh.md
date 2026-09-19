# Agent Note：拆分网关在同一重复 chat-completions index 下打包的并行工具调用

Status: implemented

[English](2026-09-17-parallel-tool-calls-repeated-index.md) | 中文

## 问题

经由 OpenAI 兼容网关的并行工具调用每次都以 `invalid arguments: "arguments" must be an object` 失败。chat-completions 翻译层按 wire `index` 分桶流式 `tool_calls` 片段，而一个在并行调用间从不推进 `index` 的网关把多个调用的参数片段拼接进同一个块——会话证据显示参数文本形如 `{"pattern": "a"}{"pattern": "b"}`。`JSON.parse` 拒绝该文本，循环以 INVALID_ARGS 失败收场，而模型不断重试它已经发出的同一形状。

## 决策

`translate`（`packages/llm/llm-deepseek/src/protocols/chat-completions/translate.ts`）在某个 delta 携带与所处 index 已映射的开放块不一致的新 `id` 或新 `function.name` 时，打开一个新的 harness 块。身份字段每次调用只流式出现一次，因此一个不一致的新值标记的是另一个调用而非延续；index 槽位随即重绑到新块，承接该调用后续的片段。翻译层本就把 `''`/`null` 身份字段视为「未变化」，所以延续 delta 永远不会误触发拆分。

## 已考虑的替代方案

**要求网关推进 `index`。** 这是 OpenAI 的正确行为，但该适配器要面对众多 OpenAI 兼容端点，包括为其他厂商模型重新编码的网关；客户端拆分一次性修复整类问题，并延续了本文件对退化身份字段的既有容忍。

**在解析时拆分拼接的参数文本。** agent loop 中的 `JSON.parse` 恢复无法区分「两个拼接的对象」与「一个合法的、内容含 `}{` 的对象」；归属事实是流式身份字段，因此决策属于能看到它们的翻译层。

## 影响

经由 index 折叠网关的并行工具调用作为独立调用执行，而分片的单调用行为不变——拆分要求出现不一致的新身份字段，合法形状不会被拆。`translate.spec.ts` 钉住两种拆分形状：新 `id`，以及在 `''` id 重复下的新 `name`。第二个调用若两个身份字段都不携带，则无法在该层拆分，其片段仍会拼接进第一个调用的参数。
