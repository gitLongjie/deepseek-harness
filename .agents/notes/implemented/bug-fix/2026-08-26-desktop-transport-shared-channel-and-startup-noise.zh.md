# Agent Note: 桌面 IPC 经 Connection 共享通道分发

Status: implemented

[English](2026-08-26-desktop-transport-shared-channel-and-startup-noise.md) | 中文

## Problem

Electron 外壳通过 IPC fetch 处理器直接调用 ApiProxy unary 分发器承载渲染进程 RPC，绕过了 `/api` 拦截链。渲染进程调用的每个 Typert 网关端点（`dynamicCordisRunner/inventory`、`syncInspectManifest`）因此返回 HTTP 404，尽管 `cordis-host-runner` 已挂载。另外，桌面启动了 web profile 的 `client-hmr` 浏览器行，其 EventSource 打开只有开发 webserver 才有的 `/plugins/events` SSE 路由；在 `dshapp://` 文件协议下该请求变成一次 ENOENT 文件读取。最后，设置编辑卡片持有挂载时的 revision，任何在卡片打开期间推送的设置写入都会让下一次 Apply 失败并报 `settings-conflict`，直到卡片重新打开。

## Decision

桌面 IPC unary 分发改走 `ctx.connection.createSharedFetchHandler('/api', fallback)`，与 HTTP 路由使用同一组合，因此拦截器认领的端点和 ApiProxy unary 路由共用一条路径。`createSharedFetchHandler` 上移到 `HostConnectionHandle` 接口（配合结构化的 `ConnectionFetchHandler`），进程内载体无需具体服务类即可消费。合成 Request 携带回环 Host 头，且只转发渲染进程的 JSON 媒体类型；共享通道的信任围栏随后把它绑定为本进程自身的流量。桌面 overlay 禁用 `client-hmr` 行，因为文件协议没有 SSE 路由。provider 编辑卡片在收到 `settings-conflict` 时重新 describe 一次命名空间，并把路径操作按新鲜 revision 重放；这些操作只命名卡片观察到的字段，因此重放是对编辑的 rebase，而不是覆盖其他写入者的字段。rebase 之后仍然冲突时照旧上报，创建卡片的拒绝语义不变。

## Alternatives considered

**把 Typert 网关端点加进 ApiProxy unary 路由表。** 不采用，因为网关在设计上就是 `/api` 共享通道上的拦截器；在第二张分发表里复制其认领会让两者漂移。

**让渲染进程连回环临时 webserver。** 不采用，因为桌面刻意通过自定义协议渲染、以 IPC 为唯一载体；为两个端点引入 HTTP 依赖会重新打开协议本可避开的信任围栏面。

**省略 `expectedRevision` 重试设置写入。** 不采用，因为盲目的最后写入者胜出会丢弃 revision 存在的意义即 compare-and-swap；按新读到的 revision 重放观察到的路径操作，为卡片看不到的每个字段保留该保证。

**在插件内部按传输方式门控 client-hmr 的 EventSource。** 不采用，因为知道不存在 SSE 路由的是桌面组合而非插件；overlay 禁用把这一点写在本地，正如 web profile 陈述自己的选择。

## Verification

`apps/desktop/tests/transport.spec.ts` 覆盖宿主就绪前的 503、带回环 Host 与转发媒体类型的拦截器认领分发、以及无 Connection 服务时的回退分发。ui-settings-models 组件测试覆盖按新鲜 revision 的一次性 rebase 与持续冲突时的拒绝。

## Consequences

桌面渲染进程可以通过 IPC 访问 Typert 网关端点，启动日志不再出现 SSE ENOENT，打开中的 provider 编辑器可以承受推送的设置写入。桌面新增对 `@deepseek-ai/dsh-client-connection` 的类型依赖。除非后续 overlay 在真实 SSE 载体之后重新启用该行，桌面开发迭代不再获得客户端插件热重载。
