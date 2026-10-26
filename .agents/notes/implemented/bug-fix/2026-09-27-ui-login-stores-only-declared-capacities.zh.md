# Agent Note：登录目录只存储网关声明过的容量

Status: implemented

[English](2026-09-27-ui-login-stores-only-declared-capacities.md) | 中文

## 问题

`LoginStore.syncCatalogFromGateway` 用 `contextWindow: m.contextWindow ?? 128_000` 和 `maxTokens: m.maxTokens ?? 4096` 映射每个拉取到的模型。当网关的 `GET /v1/models` 列表省略容量扩展字段时，登录会落出一份每行都声称 128k 上下文、4k 输出上限的目录——这些数字端点从未声明过。Deepagens 部署看到的正是这个现象：管理端的模型记录带 `context_length`，但登录拉取的目录一律显示 128k，而且这些捏造值作为持久事实被存了下来，直到目录发生变更被整体重写。

## 决策

目录行只携带列表声明过的容量。缺失的 `contextWindow`/`maxTokens` 保持缺失：`llm-deepagens` 的 section schema 本就把两个字段视为可选、仅在存在时校验，请求路径会从路由的 `defaultContextWindow`（1M）和 `maxTokens`（256k）补齐，模型页渲染"使用提供方默认值"占位符而不是捏造的数字。

## 已考虑的替代方案

**保留兜底值。** 否决：它会在产品存储持久模型元数据的位置写入一个编造的事实，此后所有下游消费方（容量引导、上下文压力计量、模型页）都基于一个没有任何端点背书的数字推理。沉默的端点就应该表现为沉默。

**让 discovery 解析更多线格式**（数字字符串、按端点嵌套的元数据）。否决：没有观察到任何网关产出这些形状——claw 网关输出整型 `context_length`/`max_output_tokens`，`capacity()` 已经读取这两种拼写。没有生产方的解析宽容是死代码。

## 后果

- 列表省略容量的部署现在会存出无容量的行；请求时窗口回退到路由默认值（1M，可经 `defaultContextWindow` 配置），而不是捏造的 128k。
- 此变更后的首次登录会重写还带着旧捏造数字的已存目录，因为计算出的行与已存行不同。
- 声明容量的网关（当前 claw 网关即是）不受影响：声明值与之前完全一致地落盘。

## 测试

login-models 规格中的混合列表现在期望无容量模型存出时不带 `contextWindow`/`maxTokens`；另有一个聚焦用例把完全沉默的列表（仅 `id`/`name`）钉为无容量的行。
