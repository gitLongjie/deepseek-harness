# Agent Note: 视频工作台路由改走 Connection Fetch 注册表

Status: implemented

[English](2026-10-07-video-workbench-connection-fetch-routes.md) | 中文

## Problem

桌面应用里的视频工作台页面报"无法加载视频工作台列表。"，而同一条路由对任何访问外壳 web-server 端口的本机 HTTP 客户端都返回带完整列表的 `200`。

宿主半边把两条路由以 `exact` 形式注册在 `ctx.webServer.register` 上。那张路由表只服务抵达 web server 套接字的请求。桌面渲染进程并非从那里提供：它加载 `dshapp://localhost/index.html`，它的 `/api/*` 请求——无论是渲染进程的 `fetch` 发出，还是媒体元素的 `src` 发出——都由 app scheme 协议处理器经 `dispatchTransportFetch` 分发（`apps/desktop/src/main/index.ts`、`src/main/ipc/transport.ts`），后者组装的是 `connection.createSharedFetchHandler('/api', connection.createChannelsFetchHandler(...))`。该处理器只查三个归属者：注册在 Connection 注册表上的精确 Fetch 路由、Typert Gateway 拦截器、以及通用 RPC channel。`/api/video-workbench/projects` 三者都不匹配，落到 channel 兜底，应答 `404`；页面的加载器 reject，渲染出失败文案。关键帧与成片的 `<img>`/`<video>` URL 同样失败，于是项目的媒体也永远加载不出来。

有两点让本包自己的测试看不见这个问题：路由是通过手搭的 web-server 桩验证的，桩只记录"注册了什么"；桌面外壳自己的传输测试又把 shared handler 打了桩。没有任何断言检查插件注册到了哪张注册表。

## Decision

两条路由改经 `ctx.connection.fetch.register` 注册在 Connection 的精确 Fetch 注册表上，且 `inject` 声明 `connection` 服务而不是 `webServer`。那张注册表正是宿主功能精确路由的、文档化的载体中立面（`ConnectionFetchRoute`："One exact, transport-independent Fetch route owned by a Host feature"），也是浏览器 `/api` 前缀路由与桌面外壳进程内传输共同分发的同一处——`/api/file`（session-controller）与 `/api/present.host`（ui-deliverables）早已这样选。

处理器改成 Fetch 形态：`writeWorkbenchFile(resolved, head, res)`（node:http 的 `ServerResponse`）变为 `workbenchFileResponse(resolved, method): Response`，放行的文件经 `Readable.toWeb(createReadStream(path))` 流式应答。只读路由不再为不归属自己的方法返回 `405`；注册表把那些方法交回常规 shared-channel 分发，与 `/api/file` 完全一致。

同一文件里顺带两处更正：删掉无人调用、且 JSDoc 声称了一个并不存在的调用方的 `readWorkbenchText` 导出；插件不再默认导出 `{ name, inject, Config, apply }`——命名空间形式是 cordis Loader 唯一保留的形式（[postmortem 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

## Alternatives considered

- **保留 web-server 路由，让桌面外壳代理这个前缀。** 拒绝：`proxyToWebHost` 只服务于 `/open-in-app/` 前缀，因为那些路由必须落在 loopback 监听器上；为一个已有载体中立注册表的插件在外壳里加按前缀白名单，等于复制分发逻辑，并为一条进程内传输本就能到达的路由重新推导浏览器 cookie 握手。
- **两个面都注册。** 拒绝：一条路由两份实现，且 web-server 那行会遮蔽注册表那行（`WebServer.match` 优先精确表），于是浏览器侧静默保留未认证路径，而测试验证的是另一份。
- **媒体改经 Remote 而不是路由。** 拒绝，理由同 feature note：整个 mp4 走 JSON Remote 意味着整段 base64，而元素的 `src` 也调不了 Remote。

## Consequences

- 列表、关键帧缩略图与成片 `<video>` 在桌面应用与浏览器里都能加载。验证方式是把真实插件挂在真实的 `HostConnectionService` 旁，并用桌面自己的组装分发请求（`tests/transport.spec.ts`）：列表 `200`、媒体 `200` 且 `video/mp4` 与完整的字节长度、越界路径 `403`。
- 请求现在先经过 Connection 的 Host/Origin 围栏与浏览器认证才会到达路由。此前 web-server 那两行绕过二者，任何本机进程——或被 DNS rebinding 的页面——都能读取被投影目录。没有外壳认证 cookie 的浏览器现在收到 `401`，此前会拿到列表。
- 本包依赖 `@deepseek-ai/dsh-client-connection`（仅类型，devDependency，用于 `ctx.connection` 的 Context merge），其 tsconfig 引用 `packages/client/connection/tsconfig.host.json` 而不是 `packages/host/webserver`。挂载工作台却没有 Connection 的 profile 会让插件停在 PENDING，而不是提供无人能到达的路由。
- `packages/video/video-workbench` 未达到逐文件 100% 覆盖率门槛：`src/projects.ts` 与 `src/file-serve.ts` 中两处不可达的防御分支（非空段列表上的 `?? ''`、`distance === ''`）早于本次改动。本次修复保持其原状，它们仍需要各自的一次整理。
