# Agent Note: Desktop Electron host runs the sandbox runner in Node mode

Status: implemented

[English](2026-09-01-desktop-electron-node-mode-runner.md) | 中文

## 问题

打包桌面应用把 harness 树以进程内方式跑在 Electron 主进程中，因此 harness 服务里读到的每个 `process.execPath` 都是 `Deepagens-Worker.exe` 而非 Node。Windows ACL 沙箱 seam 把 runner 解析为 `[process.execPath, lib/runner.js, …]`；在打包应用里这个 argv 启动的是第二个应用实例而非 runner，应用的单实例锁让第二次启动立即以退出码 0、零输出结束。于是每条受限命令都"运行"为空结果——pwsh 没有 stdout、没有 stderr、退出码为成功，任何地方都没有诊断——而本地（源码）开发环境的 `process.execPath` 是真正的 Node binary，一切正常。功能探测同样通过（第二实例同样以 0 退出），因此没有任何东西快速失败。

## 决策

runner 程序槽位保持 `[node, runner, …]` 的 argv 契约不变，seam 补上该契约的环境一侧：

- `ConfinedArgv` 携带可选 `env`：被包装 argv 的直接 spawn 所需条目。沙箱化 shell 执行器（bash 与 pwsh）把它合并进自己的 spawn 环境（排在自己条目之后）。
- 在 Electron 宿主内（`process.versions.electron` 已设置），`dsh-sandbox-local` 把 windows-acl runner 解析到磁盘上真实存在的入口——归档内已构建入口在 `app.asar.unpacked` 下的解包副本、开放 checkout 的已构建入口本身、或经 tsx 运行的包源码——并在 wrap 的 `env` 上报告 `ELECTRON_RUN_AS_NODE: '1'`。Electron 下 `existsSync` 能看进 asar 归档，因此只对非 asar 路径信任它；归档内入口没有解包副本时解析为空，`confine()` 抛出 `SANDBOX_UNAVAILABLE`（快速失败），而不是 spawn 一个无法启动的 runner。
- 桌面打包把 runner 的加载闭包（`@deepseek-ai/dsh-sandbox-windows-acl`、`@deepseek-ai/dsh-win32-process`、`koffi`）解包到磁盘，因为 Node 模式没有 asar 支持。
- runner 在 spawn 受限子进程之前从自己的环境删除 `ELECTRON_RUN_AS_NODE`（子进程经 `lpEnvironment NULL` 继承 runner 的环境块）。删除通过向 `SetEnvironmentVariableW` 传 `null` 完成：空字符串只会留下空条目，Electron 子进程仍会把它读作 run-as-node（已实证验证）。`setEnvironmentVariableW` 绑定类型放宽为接受 `string | null`。

## 已考虑的替代方案

**在桌面应用主入口处理 runner 标记参数。** 打包 exe 可以分发 `--dsh-sandbox-runner …` 到进程内 runner 调用。否决：它把通用沙箱包耦合到特定宿主应用的 CLI，且 runner 将运行在 GUI 子系统进程内，其控制台/stdio 行为不受沙箱控制。

**附带真实的 node.exe 或原生 runner binary。** 原生 exe runner 是 argv 契约的既定未来，但在它存在之前，Node 模式下的 Electron binary 是唯一保证存在的 Node 运行时，而 electron-builder 不会附带独立的 node。

**在宿主进程环境上设置 `ELECTRON_RUN_AS_NODE`。** 桌面主进程可以为所有子进程一次性导出它。否决：Electron 自己 spawn 的辅助进程继承宿主环境，翻转它们的运行模式会破坏应用。

## 后果

受限执行在打包桌面应用内恢复工作：runner 以纯 Node 运行，受限子进程继承干净的环境；忘记解包步骤的部署会大声失败（`SANDBOX_UNAVAILABLE`），而不是静默返回空结果。代价是少量解包体积（三个 node_modules 子树）和加宽一个字段的 seam 契约。seam spawn 的 JS runner 现在可以合法携带所需环境，因此未来的 runner 程序必须保持 runner 自主清除的纪律：任何受限子进程不应看到的东西都要由 runner 自己删除。

## 测试

`sandbox-local` 的 electron-host spec 在所有平台上固定解析矩阵（解包副本、缺失副本快速失败、磁盘入口、纯 Node 宿主、运维覆盖、探测环境合并）；`sandbox-windows-acl` 的 runner 套件在设置 `ELECTRON_RUN_AS_NODE=1` 的情况下 spawn 真实入口，断言受限子进程看不到它；pwsh-sandbox 与 bash-sandbox 套件在 foreground 与 background spawn 上固定 `env` 合并。一次完整的 `electron-builder --dir` 运行（`desktop-build.yml` 的打包路径）在产物上验证了解包规则：runner 包、`@deepseek-ai/dsh-win32-process`、`koffi` 与 `@koromix/koffi-win32-x64` 原生绑定全部落在 `app.asar.unpacked/node_modules/` 下，以 `ELECTRON_RUN_AS_NODE=1` 启动打包的 `Deepagens-Worker.exe` 能执行该 runner，runner 限制了一个正常工作的 `cmd` 子进程，且子进程看不到该开关。
