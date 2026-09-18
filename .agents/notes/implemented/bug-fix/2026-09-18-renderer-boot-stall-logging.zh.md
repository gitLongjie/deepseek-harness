# Agent Note: 渲染端启动记录进度并以告警快照卡死状态

Status: implemented

[English](2026-09-18-renderer-boot-stall-logging.md) | 中文

## 问题

打包版桌面端在渲染进程卡死时不留任何持久痕迹：desktop.log 记录了 host 启动和窗口加载,之后一片空白,窗口永远停在插件加载界面。[settle 修复](2026-09-18-client-boot-progress-based-settle.zh.md)已经承认永不返回的 import 会让启动一直等待而不是失败;目标机器上运行的打包版正是这种表现——没有失败对话框,也没有任何日志指明卡在哪个阶段、哪个条目、哪个包。桌面壳此前只镜像渲染进程 console 的 warning 和 error 行,而启动链路两者都不输出;`loadBundle` IPC 处理器和渲染端的包拉取同样是静默的。

## 决策

客户端启动链路通过 `[boot]` console 前缀记录自身进度(`@deepseek-ai/dsh-client-web` 的 boot-log)。`AppWebEntry` 每个阶段输出一行:boot-ready 门、模块系统构建(附 manifest 统计)、prefetch 开始与结束、mount、启动完成。`bootClient` 输出每条目的状态流转、每次 settle-pass 成员变化,以及 settle 放弃时每个条目的原因。卡死看门狗每 10 秒以 warning 快照所有未激活的条目——包含每个 pending 条目等待的服务——直到启动以任意方式结束。审计的失败文案提取为 `inactiveEntryLines`,看门狗、settle 放弃警告与 `assertEntriesActive` 三者措辞一致。

桌面壳补全日志汇:在既有无条件镜像 warning/error 之外,把带 `[boot]` 前缀的渲染进程 info 行镜像进 desktop.log;host 启动完成后记录组合出的客户端图形状,index 渲染时记录注入表形状(点名没有 application 批次的表,以及图丢失 client-modules 时从打包工件恢复的引导副本);记录每条 `loadBundle` IPC 请求的结果、字节数与耗时。桌面渲染传输在渲染端一侧记录每次包拉取,因此"请求根本没到主进程"与"主进程没有应答"可以区分。打包自检新增 `client-graph` 检查项:组合不出任何 application 客户端条目即失败——这是此前所有检查项都无法察觉的失败。`deploy-app.mjs` 在打包前先重建 workspace 的 lib 产物:对陈旧 lib 打包会静默产出一个客户端扫描一无所获的负载。

## 已考虑的替代方案

**专设一条启动诊断 IPC 通道写入主进程日志。** 否决:`console-message` 镜像已经承载渲染进程的每一条 console 行;第二条通道复制了同一个汇,还增加 preload 面积,却没有额外保真度。

**给启动加超时失败。** 暂时否决:它会改变启动的结束时机,慢机器可能被误判失败;当前缺陷是缺观测,看门狗在不改变结束行为的前提下完成诊断。如果卡死阶段可识别后静默卡死仍然复发,再重新评估。

**只在主进程埋点。** 否决:卡点位于渲染进程的插件激活过程,主进程不可见。

## 后果

卡死的启动现在会指明最后完成的阶段、最后一条条目状态流转,并在 10 秒内给出仍处于未激活状态的条目及其等待的服务。浏览器直接访问的 web 运行在 devtools 里看到相同的行。`[boot]` 前缀是 client-web 启动日志器与桌面主进程镜像过滤器之间的约定;改动任一侧必须同步另一侧。启动日志为每次条目状态流转增加一行渲染进程 console,仅在 desktop.log 中被镜像。对陈旧 workspace lib 的打包现在会先重建(每次打包多花几分钟),不再发出插件加载界面永不消失的负载。

## 验证

`packages/client/web/tests/boot-client.client.spec.ts` 固定看门狗行为(间隔快照、空快照静默、stop)、与审计共享的 `inactiveEntryLines` 文案、以及 settle 放弃警告;boot 与 mount 用例覆盖每一条阶段行。`tsc -b` 对 `packages/client/web` 与 `apps/desktop` 通过。这套埋点在第一次带上日志的运行中就定位了插件加载卡死:新的 graph、table 与 index 大小行把问题收敛到[客户端扫描解析基址缺陷](2026-09-18-client-scan-resolves-from-installed-host.zh.md)——真实安装上 1 个 application 条目、47,505 字符的 index;该修复落地后是完整名册(61 个条目,约 12.6MB)。
