# Agent Note: Opening a Workspace directory reaches the file manager

Status: implemented

English | [中文](2026-09-21-open-workspace-directory-in-file-manager.md)

## Problem

Windows 上工作区行的「在资源管理器中打开」点了没有任何反应。这一次点击背后有三个彼此独立的缺陷，而只有第三个能解释为什么它在所有主机上都是死的。

**插件从未声明它调用的 Remote namespace。** `ui-workspace` 的浏览器入口调用 `ctx.remote.session.openWorkspacePath(...)`，而它的 `inject` 只列了 `remote` 与 `remote.directoryPicker`。Cordis 通过被追踪的 `remote` 服务解析 `ctx.remote.<ns>`，对未声明的 namespace 抛出 `cannot get property "remote.session" without inject`。该异常发生在回调运行时而非加载时，因此插件加载一切正常、其他动作全部可用，只有 reveal 点击失败。git 历史锁定了丢失点：`921b4e1213` 引入该动作时声明了 `'remote.session'`，而合并提交 `581803bf57` 把 inject 行收敛成更短的列表时丢掉了它——同族的 `remote.directoryPicker` 条目保留了下来，这正是这处遗漏读起来像是有意为之的原因。渲染器记录了该异常，行的 `.catch` 又把它变成 `console.warn('workspace directory reveal rejected:', ...)`，所以失败从未到达屏幕。

**目录被交给了 shell 的默认动词。** 行菜单调用 `session/openWorkspacePath`，传入工作区路径加一个尾随的 `/.`——这是客户端的小把戏，想让宿主「默认应用」打开器把目录当成文档处理。该打开器在 Windows 上执行 `Invoke-Item -LiteralPath <path>`，而 `Invoke-Item` 会解析 `Directory` 类的默认 shell 动词：`HKLM\SOFTWARE\Classes\Directory\shell` 下由宿主改写的注册表值，在报告该缺陷的机器上读到 `none`，不指向任何命令。子进程于是以 0 退出却什么也没打开。

**共享运行器隐藏了它被要求弹出的那个窗口。** `runNativeCommand` 始终传入 `windowsHide: true`，而该标志隐藏的是子进程创建的第一个窗口，并不只是 console 子系统子进程的瞬时控制台。Windows 上每一次文件管理器交接都经由 `explorer.exe`，因此 `revealNativePath` 的 `/select,` 交接早已因同一原因失效；只把目录意图改派给 `explorer.exe` 而不改这个标志，观察不到任何变化。

同一处漏声明也存在于 `experimental/client-ui-agent-team`：`mount.ts` 导出 `inject = ['sessions', 'remote', 'slots', 'locale']`，而 `registerUi` 读取 `ctx.remote.agentTeams`。这是实验性界面上一处独立的既有缺陷，留给其归属方处理。

## Decision

`ui-workspace` 的 `inject` 在它读取的其他 namespace 旁声明 `'remote.session'`，并由一个 spec 从源码推导该要求，而不是复述那份列表：它扫描浏览器入口中的 `ctx.remote.<ns>` 读取，断言每一条都已被声明。复述声明列表无法满足该检查，这正是原先那处遗漏能在「逐字断言列表」的 spec 下存活的原因。单元 bench 提供该 namespace，使插件自身的 inject 声明保持可满足。

路径打开器在 `default` 与 `text-editor` 之外新增第三种意图：`openNativeDirectory(path, signal)` 把目录交给平台文件管理器。Windows 直接启动 `explorer.exe <path>`，不再查询 shell 的按类默认动词；Finder 与 `xdg-open` 照旧接收目录，WSL 路径先行转换。

`runNativeCommand` 新增可选的 `NativeCommandOptions`，其 `windowsHide` 默认为 true——即抑制 console 子进程瞬时窗口的策略。`NativeCommandRunner` 接缝携带该选项，因此调用方为它所 spawn 的命令声明可见性策略，注入的运行器只负责应用它，而不是取代它：`runExplorer` 把每一次 Explorer 交接都发为 `run('explorer.exe', args, signal, { windowsHide: false })`，`revealNativePath` 与目录意图共用它。这条接缝不止关乎默认值，因为 `open-in-app` 会为注册表与图标命令注入自己的 `run`，否则会重新丢掉该策略。Explorer 的退出码 1 仍按已转交请求接受，因此 `revealNativePath` 本就携带的容错移入这一个助手，而不是写两遍。

每个意指「这是目录」的调用方现在都明说，而不是指望默认动词与它一致。`SessionOpenWorkspacePathRequest.action` 由 `'reveal'` 扩展为 `'reveal' | 'directory'`，`session/openWorkspacePath` 把新变体分派给专用的 `openDirectory` 交接（`SessionControllerInternals.openDirectory`，默认 `openNativeDirectory`）。工作区浏览器注入的动作更名为 `openWorkspaceDirectory`，用裸工作区路径发送 `action: 'directory'`；`/.` 后缀及其 `workspaceDirectoryPath` 助手一并删除。`settings/openAgentPresetDirectory` 改用 `SettingsControllerInternals.openDirectory` 并调用它——原有的 `openPath` 插槽没有其他消费方，已移除。`open-in-app` 的 `shell-open` 启动改为运行 `openNativeDirectory`，其文件管理器条目因此与 Explorer 走同一条路。

## Alternatives considered

**保留 `Invoke-Item`，失败时回退到 `explorer.exe`。** 当默认动词不指向任何命令时 `Invoke-Item` 仍以 0 退出，因此既没有可检测的失败，也没有触发回退的时机。改为探测注册表配置错误，则会让 harness 在每次打开时都去读 `Directory\shell` 的默认值。

**保留 `windowsHide: true`，把注册表当作唯一原因。** 在报告缺陷的主机上实测：`execFile('explorer.exe', [dir], { windowsHide: true })` 不弹窗，`{ windowsHide: false }` 弹窗，两者都退出 1；而对同一目录执行 `Invoke-Item` 两种情况下都不弹窗。两个原因彼此独立，只修其中一个，点击仍然是死的。

**对整个路径打开器去掉 `windowsHide`。** 该标志正是用来避免 `powershell.exe`、`wslpath` 与 `xdg-open` 在每次打开时闪出控制台。只有会自行弹窗的子进程才选择不隐藏。

**在路径打开器内部保留两个默认运行器，一个隐藏、一个可见。** 这对默认适配器可行，但对注入自己 `run` 的调用方不行：`open-in-app` 会把它组合的运行器传进来执行注册表与图标命令，Explorer 交接就会再次静默继承隐藏的那个。策略属于命令本身，因此随运行器参数传递。

**保留逐字断言 `inject` 的写法作为护栏。** 它复述的就是它所检查的那份声明，因此作者写出任何列表它都通过——包括那份坏掉的。只有从源码推导的扫描才让该要求可证伪。

**只在目录场景下由各调用方自行 spawn `explorer.exe`。** 三个包会各自持有一份相同的 Windows 特定决策——命令与其可见性标志——其中两个位于 `packages/api`，会把本应由路径打开器承担的平台分支带进 API 层。

**保留尾随的 `/.`，只换命令。** 该后缀是客户端对路径种类的断言；宿主负责解析工作区路径，应当被告知种类，而不是被迫从标点推断。

## Consequences

行的 reveal 动作终于能到达 Host，三个打开目录的界面也在 `Directory` 类默认动词不可用的主机上恢复工作；Windows 上原本静默失效的文件管理器 reveal 同样恢复。目录打开不再依赖客户端给宿主路径追加标点。`openNativePath` 对文档保持原有行为，包括 HTML 与 SVG 的浏览器优先，其 console 子进程仍保持窗口隐藏。新意图与运行器选项对 `dsh-native-command` 的公开面是增量式的；`revealNativePath` 契约不变（选中文件，Linux 上打开其父目录），只是共用了 Explorer 交接助手。若调用方把文件传给 `openNativeDirectory`，在 Windows 上会得到 Explorer 打开该文件所在文件夹——意图表达的是调用方的本意，而当前没有调用方这样做。`windowsHide` 现在只隐藏它名字所指的东西，因此未来任何 GUI 子进程都必须显式选择不隐藏，而不会静默地不出现。

那处漏声明之所以不可见，是因为 Remote namespace 的读取发生在回调内部：加载时没有任何东西指向它，而单元 bench 的 Remote 替身是普通对象，其 namespace 属性根本到不了 Cordis 的守卫。`SlotTestRuntime` 确实会强制该声明，这正是装配渲染器 bench 需要提供该 namespace 的原因——那种失败是检查在起作用，不是回归。

## Testing

`packages/client/ui-workspace/tests/apply.client.spec.ts` 推导浏览器入口读取的每一个 `ctx.remote.<ns>`，断言 `inject` 声明覆盖它们，并通过注入回调驱动 `openWorkspaceDirectory`，固定 `action: 'directory'` 载荷与拒绝路径。`packages/util/native-command/tests/path-opener.spec.ts` 固定目录意图在各平台的命令、交给 Explorer 前的 WSL 转换、退出码 1 容错、其他失败与取消的保留、不支持的平台、名为可渲染文档的目录绝不进入浏览器分支，以及两处 Explorer 交接都以 `windowsHide: false` 到达运行器，而其他所有命令保持隐藏默认值。`packages/api/session-controller/tests/session-open-workspace-path.host.spec.ts` 固定 `directory` 动作分派到目录交接而非默认应用交接；`packages/api/settings-controller/tests/settings-controller.host.spec.ts` 固定 preset 目录经目录交接打开。`packages/host/open-in-app/tests/resolver.spec.ts` 固定 `shell-open` 启动发出 `explorer.exe`。`packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` 固定行菜单传入裸工作区路径，以及被拒绝的交接被报告而非留下未处理的拒绝。原生桌面验证归 Windows 负责：在报告缺陷的主机上，交付后的打开器会弹出文件夹窗口，reveal 交接会选中文件，而此前两者都是死的。
