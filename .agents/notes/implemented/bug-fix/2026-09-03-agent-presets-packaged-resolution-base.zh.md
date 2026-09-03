# Agent Note：Agent preset 在打包运行时从归档根解析插件行

状态：已实现

[English](2026-09-03-agent-presets-packaged-resolution-base.md) | 中文

## 问题

在全新安装的打包版桌面应用上，每个新会话都以 `agent-preset-invalid` 失败：名册健康检查报告内置的 `standard` preset 已损坏，原因是"23 rows name plugins that cannot be resolved"。同一安装下已有会话正常、宿主正常启动，因此故障特定于 agent preset 解析自身插件包的方式。

## 决策

`dsh-agent-presets` 在 Electron `app.asar` 归档内运行时，把裸包名的解析锚定到应用归档根——从自身模块位置检测（`installedHostBase`）；在所有开放布局中，锚点保持为组合目录的基址（`ctx.baseUrl`）。两处解析位置都应用该规则：名册健康检查（`AgentPresets`）与常驻挂载（`mountPreset` 的 `PresetTree.import`），因此被报告为健康的 preset 也一定能导入。

打包桌面会跳过 `healProfilesModuleFallback`，所以干净机器上 `$DSH_HOME/profiles/node_modules` 永远不存在，从组合基址（可写 profile 目录）出发的向上 `node_modules` 走查一无所获。打包运行时本来就已通过 `bareModuleBaseUrl`（归档根）解析裸的 Loader 导入——`electron-builder` 把完整的插件闭包都打进了归档；preset 这一环是唯一仍在读取组合基址的消费者。从归档根出发的同一条走查可以回答每一行，而 Electron 主进程的 `fs` 能穿透归档（启动期资源断言已依赖这一点）。

## 被否决的替代方案

**像 `client-modules` 那样消费 boot 提供的 `dshBareModuleBaseUrl` 环境服务。** 否决：通过 context 代理读取它要求在行的 `inject` 中声明，这会把一项可选的细化变成必需服务，并迫使每个裸测试 harness 都去 provide 它。在简单 harness 中 provide 该值还会扰动按作用域分层的 prompt 测试，使 inject 设计无法通过本套件评审。

**通过名册配置下发打包基址。** 否决：基址是安装宿主的运行时事实，不是部署选择；每个部署都得携带可能与实际布局漂移的样板配置。

## 后果

全新打包安装恢复创建会话：名册健康检查报告内置 preset 健康，常驻挂载从归档导入其插件行。开发与已安装 CLI 布局不变——helper 在那里返回 undefined，组合基址继续通过已修复的 profile 回退回答。
