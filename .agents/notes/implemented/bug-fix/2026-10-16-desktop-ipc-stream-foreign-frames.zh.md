# Agent Note: The desktop IPC carrier keeps another stream's frames out of a session journal

Status: implemented

[English](2026-10-16-desktop-ipc-stream-foreign-frames.md) | 中文

## Problem

桌面端报出 `gateway/internal: session event stream emitted an entry before its opening cursor`。这条消息来自 `RemoteJournalStream.opening`（`packages/api/gateway/src/client/journal-stream.ts`）：任何一代物理流只要第一个送达的条目不是它的开仓游标，就整条拒绝；流名由 `SessionEventStream`（`packages/api/session-controller/src/client/transport.ts`）给出。正常的 Host 触发不了它：`SessionHistory.follow`（`packages/api/session-controller/src/history.ts`）先产出快照才进入实时循环，而传输层测试只用合成帧锁定了客户端的拒绝行为。

真正的原因在桌面端渲染进程自己的流载体上。Remote 流经 Electron IPC 承载（`apps/desktop/src/render/transport.ts`、`apps/desktop/src/main/ipc/transport.ts`）：Host 为每条逻辑流铸一个 `streamId`，用 `dsh:stream:open` 的应答把它交回渲染进程，并在渲染进程用 `dsh:stream:claim` 认领之前不推送任何帧。所有逻辑流的条目都广播在共享的 `dsh:stream:frame` / `dsh:stream:end` 通道上，因此每个开启方各自挂监听、各自按自己的 id 过滤——而这个 id 只有等到开流应答回来才知道，比挂监听晚一个来回。当时的过滤是 `if (streamId !== undefined && frame.streamId !== streamId) return`：在本开启方还不知道自己 id 的那段时间里，桥上任何一条已经在推流的**其他**流的帧都能通过过滤，被塞进本开启方的收件箱。于是「开着另一个正在流式输出的会话时再打开一个会话」会把一条外来的实时 `entry` 排在本日志自己的开仓游标前面，整条日志流随即失败。外来的 `end` 帧同理：它在 id 未知时就置了 `ended`，新流会立刻结束。

这个认领握手本来就是为防这一类混淆而设，却没有任何用例断言「并发中的另一条流不会被认成本流」：`apps/desktop/tests/ipc-stream.spec.ts` 只覆盖了所有相关开启方都已知道自己 id 之后才到达的帧。

## Decision

`createIpcStreamOpen` 的入队判断改为：只要本开启方还不掌握自己的 id 就丢弃该帧（`streamId === undefined || frame.streamId !== streamId`），不再缓冲可能属于别的流的帧。

可以安全丢弃，是因为既有握手已经保证了顺序：Host 的 `startPump` 只由 `dsh:stream:claim` 触发，而渲染进程是在从应答里拿到 id 并赋值之后才发出认领。因此本流的帧不可能早于本开启方认出它而到达，而带着别的 id 的帧也永远不可能成为本流的条目。收件箱依然缓冲本流在认领之后、首次 `next()` 之前到达的帧——这正是它今天承载的内容。

`apps/desktop/tests/ipc-stream.spec.ts` 把两端都钉住：一个用例在开流应答尚未回来时广播一条外来 entry，要求取到的是本流自己的开仓帧；另一个用例广播外来 end，要求本流继续运行。两个用例在旧判断下都会失败（前者把外来 entry 当作本流首条条目返回，后者立即结束）。

## Alternatives considered

- **每条流各用一条 IPC 通道（`dsh:stream:<id>:frame`）。** 否决：同样的保证却要改 preload/main 的通道契约，会说这种新协议的渲染进程必须配一个已经带上它的壳，桌面端的两半必须永远同版本。过滤在既有协议内就能拿到同样的隔离。
- **像浏览器 WebSocket 多路复用客户端那样在渲染进程铸 `streamId`（`packages/api/gateway/src/client/stream-client.ts`）。** 否决：泵和它的取消登记表都在主进程，让渲染进程铸 id 等于让 Host 信任一个调用方给的相关 id，还要在推流前先做重名校验。id 空间应当由往里推流的一方拥有。
- **让日志客户端容忍游标之前的条目并修复窗口。** 否决：一代物理流既然把别的流的条目送了过来，就已经破坏了载体自己的契约；修复它等于默默接受错误的字节，而这条协议检查正是让这个 bug 暴露出来的东西。

## Consequences

- 在另一个会话流式输出时打开新会话，不再以协议违例失败；新增用例在没有修复时会失败，这就是这类串流被堵住的证据。
- 认领握手如今两端都成了承重结构，也两端都有测试：本 spec 钉住「另一条流广播的帧永远不会被认领」，`apps/desktop/tests/transport.spec.ts` 钉住「Host 只在认领之后才推流」。
- 同一条规则适用于将来任何「一条通道广播给多个按流读取方」的载体：读取方只能接受自己已经持有其 id 的帧，因为共享通道无法告诉它某帧属于哪条尚未识别的流。
- 改动位于桌面壳的渲染进程，因此打包后的应用只有在重新构建后才带上它：与 profile 里随取随换的 Web 产物不同，没有任何 profile 或客户端插件热重载路径能触达 render transport。`apps/desktop/dist/render-transport.js` 由 `pnpm --filter @deepseek-ai/dsh-desktop build:render-transport` 重建，`scripts/dev.ts` 在启动前已经会跑它。
- 相关但不构成取代：[Session Controller 线上订阅释放那条记录](2026-09-21-session-controller-wire-subscription-disposal.zh.md)描述的是重新激活时每条流的监听数量增长。本次修的是监听接受哪些帧，不是存在多少监听；注销监听的 `finally` 块没有改动。
