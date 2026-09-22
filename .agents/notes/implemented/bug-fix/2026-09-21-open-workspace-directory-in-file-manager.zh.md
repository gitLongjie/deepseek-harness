# Agent Note: Opening a Workspace directory reaches the file manager

Status: implemented

English | [中文](2026-09-21-open-workspace-directory-in-file-manager.md)

## Problem

Windows 上工作区行的「在资源管理器中打开」点了没有任何反应。行菜单的 reveal 动作调用 `session/openWorkspacePath`，传入工作区路径加一个尾随的 `/.`——这是客户端的小把戏，想让宿主「默认应用」打开器把目录当成文档处理。随后有两个彼此独立的缺陷吞掉了这次点击。

默认应用打开器在 Windows 上执行 `Invoke-Item -LiteralPath <path>`，而 `Invoke-Item` 会解析 `Directory` 类的默认 shell 动词。该动词是 `HKLM\SOFTWARE\Classes\Directory\shell` 下由宿主改写的注册表值：在装有某类 shell 扩展、把它改成不指向任何命令的主机上（报告该缺陷的机器读到的值是 `none`），子进程会以 0 退出却什么也没打开，GUI 也报不出失败。

另一个缺陷在共享运行器里。`runNativeCommand` 始终传入 `windowsHide: true`，而该标志隐藏的是子进程创建的第一个窗口，并不只是 console 子系统子进程的瞬时控制台。Windows 上每一次文件管理器交接都经由 `explorer.exe`，因此 `revealNativePath` 的 `/select,` 交接早已因同一原因失效；只把目录意图改派给 `explorer.exe` 而不改这个标志，观察不到任何变化。

## Decision

路径打开器在 `default` 与 `text-editor` 之外新增第三种意图：`openNativeDirectory(path, signal)` 把目录交给平台文件管理器。Windows 直接启动 `explorer.exe <path>`，不再查询 shell 的按类默认动词；Finder 与 `xdg-open` 照旧接收目录，WSL 路径先行转换。

`runNativeCommand` 新增可选的 `NativeCommandOptions`，其 `windowsHide` 默认为 true——即抑制 console 子进程瞬时窗口的策略。`NativeCommandRunner` 接缝携带该选项，因此调用方为它所 spawn 的命令声明可见性策略，注入的运行器只负责应用它，而不是取代它：`runExplorer` 把每一次 Explorer 交接都发为 `run('explorer.exe', args, signal, { windowsHide: false })`，`revealNativePath` 与目录意图共用它。这条接缝不止关乎默认值，因为 `open-in-app` 会为注册表与图标命令注入自己的 `run`，否则会重新丢掉该策略。Explorer 的退出码 1 仍按已转交请求接受，因此 `revealNativePath` 本就携带的容错移入这一个助手，而不是写两遍。

每个意指「这是目录」的调用方现在都明说，而不是指望默认动词与它一致。`SessionOpenWorkspacePathRequest.action` 由 `'reveal'` 扩展为 `'reveal' | 'directory'`，`session/openWorkspacePath` 把新变体分派给专用的 `openDirectory` 交接（`SessionControllerInternals.openDirectory`，默认 `openNativeDirectory`）。工作区浏览器注入的动作更名为 `openWorkspaceDirectory`，用裸工作区路径发送 `action: 'directory'`；`/.` 后缀及其 `workspaceDirectoryPath` 助手一并删除。`settings/openAgentPresetDirectory` 改用 `SettingsControllerInternals.openDirectory` 并调用它——原有的 `openPath` 插槽没有其他消费方，已移除。`open-in-app` 的 `shell-open` 启动改为运行 `openNativeDirectory`，其文件管理器条目因此与 Explorer 走同一条路。

## Alternatives considered

**保留 `Invoke-Item`，失败时回退到 `explorer.exe`。** 当默认动词不指向任何命令时 `Invoke-Item` 仍以 0 退出，因此既没有可检测的失败，也没有触发回退的时机。改为探测注册表配置错误，则会让 harness 在每次打开时都去读 `Directory\shell` 的默认值。

**保留 `windowsHide: true`，把注册表当作唯一原因。** 在报告缺陷的主机上实测：`execFile('explorer.exe', [dir], { windowsHide: true })` 不弹窗，`{ windowsHide: false }` 弹窗，两者都退出 1；而对同一目录执行 `Invoke-Item` 两种情况下都不弹窗。两个原因彼此独立，只修其中一个，点击仍然是死的。

**对整个路径打开器去掉 `windowsHide`。** 该标志正是用来避免 `powershell.exe`、`wslpath` 与 `xdg-open` 在每次打开时闪出控制台。只有会自行弹窗的子进程才选择不隐藏。

**在路径打开器内部保留两个默认运行器，一个隐藏、一个可见。** 这对默认适配器可行，但对注入自己 `run` 的调用方不行：`open-in-app` 会把它组合的运行器传进来执行注册表与图标命令，Explorer 交接就会再次静默继承隐藏的那个。策略属于命令本身，因此随运行器参数传递。

**只在目录场景下由各调用方自行 spawn `explorer.exe`。** 三个包会各自持有一份相同的 Windows 特定决策——命令与其可见性标志——其中两个位于 `packages/api`，会把本应由路径打开器承担的平台分支带进 API 层。

**保留尾随的 `/.`，只换命令。** 该后缀是客户端对路径种类的断言；宿主负责解析工作区路径，应当被告知种类，而不是被迫从标点推断。

## Consequences

三个打开目录的界面在 `Directory` 类默认动词不可用的主机上恢复工作，Windows 上原本静默失效的文件管理器 reveal 也恢复工作。目录打开不再依赖客户端给宿主路径追加标点。`openNativePath` 对文档保持原有行为，包括 HTML 与 SVG 的浏览器优先，其 console 子进程仍保持窗口隐藏。新意图与运行器选项对 `dsh-native-command` 的公开面是增量式的；`revealNativePath` 契约不变（选中文件，Linux 上打开其父目录），只是共用了 Explorer 交接助手。若调用方把文件传给 `openNativeDirectory`，在 Windows 上会得到 Explorer 打开该文件所在文件夹——意图表达的是调用方的本意，而当前没有调用方这样做。`windowsHide` 现在只隐藏它名字所指的东西，因此未来任何 GUI 子进程都必须显式选择不隐藏，而不会静默地不出现。

## Testing

`packages/util/native-command/tests/path-opener.spec.ts` 固定目录意图在各平台的命令、交给 Explorer 前的 WSL 转换、退出码 1 容错、其他失败与取消的保留、不支持的平台、名为可渲染文档的目录绝不进入浏览器分支，以及两处 Explorer 交接都以 `windowsHide: false` 到达运行器，而其他所有命令保持隐藏默认值。`packages/api/session-controller/tests/session-open-workspace-path.host.spec.ts` 固定 `directory` 动作分派到目录交接而非默认应用交接；`packages/api/settings-controller/tests/settings-controller.host.spec.ts` 固定 preset 目录经目录交接打开。`packages/host/open-in-app/tests/resolver.spec.ts` 固定 `shell-open` 启动发出 `explorer.exe`。`packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` 固定行菜单传入裸工作区路径，以及被拒绝的交接被报告而非留下未处理的拒绝。原生桌面验证归 Windows 负责：在报告缺陷的主机上，交付后的打开器会弹出文件夹窗口，reveal 交接会选中文件，而此前两者都是死的。
