# Agent Note：在 Electron 宿主中以 node 模式运行 Windows Job runner

Status: implemented

[English](2026-09-17-subprocess-runner-electron-node-mode.md) | 中文

## 问题

桌面宿主里的每一次子进程工具调用——pwsh、grep、glob——都永远挂起：`tool/call` 已持久化却没有任何结果到达，停止与 Escape 无法结束回合，恢复时只能合成 `TOOL_OUTCOME_UNKNOWN`。Windows Job runner 用 `process.execPath` 启动 runner 子进程；在桌面里这个可执行文件就是应用本体，缺少 Node 开关时子进程会启动第二个应用实例（单实例锁让它无输出退出，或作为 GUI 进程常驻），永远不会说 runner 的控制协议，`done` 永不结算。`sandbox-local` 的 Windows runner 已处理这种宿主形态；`subprocess-local` 没有。

## 决策

`runnerEnvironment`（`packages/subprocess/subprocess-local/src/runner-launch.ts`）在宿主为 Electron 时设置 `ELECTRON_RUN_AS_NODE: '1'`，runner 子进程因此以同一可执行文件下的纯 Node 运行。每次 spawn 都在父侧构建目标环境并经 IPC 下发，该开关不会到达任何 target。`launchWindowsJob`（`packages/subprocess/subprocess-local/src/windows-job.ts`）另外把「runner 报告 target 结果前触发的调用方中止」按基础设施失败处理：`done` reject 并终止 runner。启动期楔死因此会在调用方期限处失败——工具结果结算、回合关闭、停止与 Escape 恢复有效。

## 已考虑的替代方案

**在 agent loop 中给中止 drain 加期限。** 用竞速宽限期结束回合可以无视挂死的提供方，但它在一个自身契约已指明调用方信号为升级触发器的 seam 之上硬编码期限；在 spawn seam 处结算让 loop 保持简单，并同时修复所有消费方。

**把 runner 解析到磁盘解包入口。** `sandbox-local` 需要那样做是因为它的 runner 要启动一个不能留在归档内的原生可执行文件；Job runner 是纯 JavaScript，经应用本体以 node 模式运行完全正确。

## 影响

桌面中的子进程工具与纯 Node 下一样执行并结算；启动期楔死不再可能超过调用方的中止，协作式工具超时与停止/Escape 总能解除 spawn 的阻塞。结果前置的中止以提供方失败 reject `done`（调用方本就按中止分类），结果送达后的迟到中止被忽略。`windows-job.spec.ts` 钉住两者；`spawn-runner.spec.ts` 钉住该开关在 Electron 下存在、纯 Node 下缺席。
