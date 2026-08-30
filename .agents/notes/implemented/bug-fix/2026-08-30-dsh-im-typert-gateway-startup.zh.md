# dsh-im 使用当前 Host Remote 网关

[English](2026-08-30-dsh-im-typert-gateway-startup.md) | 中文

Desktop 配置已不再提供已删除的 `apiProxy` 服务。dsh-im 现在等待 `connection`、`credentials` 和 `typertGateway`，并把 Gateway 的一元调用适配到现有 HarnessClient 载体，使插件装载依赖与 ApiProxy 删除后的 Host 组合一致。

该适配器只用于本机调用；显式配置 `harnessBaseUrl` 时仍使用 HTTP/WebSocket 载体。旧本机交互客户端的事件响应路径仍待迁移到 Gateway Remote Event result 端点。
