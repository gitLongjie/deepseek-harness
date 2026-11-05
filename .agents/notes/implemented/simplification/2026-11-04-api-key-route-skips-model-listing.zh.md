# Agent Note: API key 路由不请求官方模型列表

Status: implemented

[English](2026-11-04-api-key-route-skips-model-listing.md) | 中文

## 问题

只要存有 API key，且 `models` 仍与内置目录相同，`llm-deepseek-api-key` 就会请求 `GET https://api.deepseek.com/models`。该列表使用 `Authorization: Bearer` 鉴权。路由发送的是 Messages 使用的 `x-api-key`。端点返回 HTTP 401，路由警告已保存的凭据被拒绝，然后仍然提供内置目录。刷新会再次发出该请求。

## 决策

- [`llm-deepseek-api-key`](../../../../packages/llm/llm-deepseek-api-key/README.zh.md) 不请求 `GET /models`。模型发现和模型解析提供配置的 `models` 目录。默认是内置目录 `deepseek-flash` 与 `deepseek-v4-pro`。缺少 key 时，模型选择器仍然隐藏该路由。
- `modelsTimeoutMs` 与 `modelsMaxAgeMs` 仍被接受并校验，以便已有配置能够加载。它们不会发出列表请求。
- [账号路由](../architecture/2026-09-24-deepseek-account-remote-model-catalog.zh.md) 仍然跟随自己的 `/models` 列表。共享列表缓存留在 Messages 传输包中，供该路由使用。
- 这撤回了[官方列表记录](../architecture/2026-10-22-deepseek-official-model-listing.zh.md)中 API key 路由跟随列表的决定。

## 考虑过的替代方案

**保留请求，并在 HTTP 401 或 403 后停止。** 每个进程仍会发出一次被拒绝的请求，并打印凭据警告。本决定去掉的就是这个请求。

**改为发送 `Authorization: Bearer`，让列表成功。** 有效的 key 会收到列出的模型，但请求仍会继续。Messages 鉴权保持 `x-api-key`。

**从 API key 配置中删除 `modelsTimeoutMs` 和 `modelsMaxAgeMs`。** 已保存且设置了这些字段的 profile 会加载失败或丢掉这些字段。它们继续被接受，但不使用。

## 影响

- 官方端点上的 API key 用户不再等待 `GET /models`，也不会因此收到警告。他们得到的是配置的目录。
- 服务端之后新增的模型，要等发版更新内置目录，或部署写入 `models`，才会到达 API key 用户。
- 账号路由的列表、刷新和客户端版本门控不变。
