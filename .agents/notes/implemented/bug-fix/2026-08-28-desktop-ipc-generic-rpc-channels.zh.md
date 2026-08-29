# Agent Note：桌面 IPC 分发覆盖通用 RPC 通道

状态：已实现

[English](2026-08-28-desktop-ipc-generic-rpc-channels.md) | 中文

## 问题

桌面 IPC fetch 桥把渲染层的每个请求都送进 `ctx.connection.createSharedFetchHandler('/api', fallback)`。该处理器只识别共享 `/api` 通道下的端点；凡是首段路径为 `connection.rpc.handle` 注册的专用通道的请求——例如 dsh-im 设置页的 `/weixin/connection.status`——都会落到裸 ApiProxy 一元分发器，而它不认识该通道，于是返回 HTTP 404。同样的调用在 Web 宿主上正常，因为 `handle` 会在真实 webserver 上为每个通道注册一条 HTTP 前缀路由，而桌面进程内载体从不查询这张路由表。

## 决策

`HostConnectionService` 现在把每个 `rpc.handle` 注册连同其 HTTP 路由一起记入通道表，并在 `HostConnectionHandle` 上暴露 `createChannelsFetchHandler(fallback)`：该 Fetch 处理器按路径首段在已注册通道中解析，套用与 HTTP 路由相同的信任门（loopback 通道不带额外受信方校验，trusted-host 通道使用部署的 `trustedHosts`），未认领的路径走 fallback。桌面 IPC 分发器改为组合 `createSharedFetchHandler('/api', createChannelsFetchHandler(fallback))`，因此 `/api` 端点仍走拦截器链，通用通道走通道分发器，二者继续复用原来的合成 loopback Request。

## 已考虑的替代方案

**让桌面渲染层给通用通道加 `/api` 前缀。** 否决：客户端 RPC 调用方与传输无关，且 Web 服务器在根路径上路由通道；按载体改写路径会分裂已发布应用和插件共同依赖的线上契约。

**把桌面的临时 webserver 端口暴露给渲染层。** 否决：桌面刻意保持 IPC 为唯一载体；引入 HTTP 依赖会重新打开自定义 scheme 想避开的信任面。

**把通用通道并入 ApiProxy 一元分发器。** 否决：该分发器服务 Typert 网关的方法表，而非 `rpc.handle` 通道；让它同时查询通道注册表会在两个服务里重复分发逻辑。

## 验证

`packages/client/connection/tests/node-half.host.spec.ts` 覆盖通道分发的 200 响应、不可信 Host 的 403 拒绝、`/api` 路径的 fallback，以及 dispose 后的路由撤销。`apps/desktop/tests/transport.spec.ts` 覆盖组合分发到达 `/weixin/connection.status`，并保留拦截器认领的 `/api` 用例。

## 后果

注册专用 RPC 通道的插件（dsh-im 的分渠道管理 RPC）在桌面外壳内无需改动即可工作。通用通道的信任判定在 HTTP 路由与 IPC 载体两端绑定同一道门；通道表的生命周期与路由注册的撤销联动，通道释放后两条载体在同一节拍内停止应答。
