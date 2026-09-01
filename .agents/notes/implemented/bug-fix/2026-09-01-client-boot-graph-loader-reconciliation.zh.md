# Agent Note: Client boot graph Loader reconciliation

Status: implemented

[English](2026-09-01-client-boot-graph-loader-reconciliation.md) | 中文

## Problem

桌面客户端可能收到一份启动图，其中包含运行时挂载的目录选择器界面，却没有提供 `slots` 与 `uiWorkspace` 服务的静态 UI renderer 和 workspace 条目。浏览器 Loader 会让选择器保持 pending，并在全新安装后显示启动失败。

## Decision

`ClientModuleRegistry.graph()` 在返回启动图前协调当前所有 Loader 条目，webserver 的 index 注入监听器读取该方法。该协调会捕获在注册表开始监听 `internal/plugin` 生命周期事件前已经存在的客户端条目；监听器仍负责发布之后动态新增和移除的条目。

在打包应用中，注册表从 `dshBareModuleBaseUrl` 解析裸 Loader 条目；该地址是桌面端 root Include 导入裸包时使用的安装应用位置。相对路径、绝对路径和 file 条目仍使用所属树的基准地址。可写的 `$DSH_HOME` profile 无法解析到 `app.asar` 内部，因此若使用它的 URL 解析静态裸条目，就会错误地从启动图省略这些条目。

因此，桌面壳渲染注入后的 `index.html` 时，启动图包含 renderer、workspace 和已选择的目录选择器界面。浏览器 Loader 可以先激活服务提供者，再激活选择器，选择器随后注册两个目录流程占位项。

## Alternatives considered

**只依赖 `internal/plugin` 事件。** 否决：事件订阅不会回放，注册表在某个 Loader 条目之后创建时，单靠后续事件永远无法发现该条目。

**始终从可写 profile 树解析每个条目。** 否决：这与开放源码运行相符，但打包后的桌面 profile 有意放在 `app.asar` 之外。它的静态裸条目已经从安装宿主导入，元数据发现必须使用同一位置。

**为选择器添加后备 `slots` 或 `uiWorkspace` 实现。** 否决：选择器需要真实的 renderer 与 workspace 导航服务。后备实现会掩盖不完整的启动图，并让目录流程无法使用。

**把原生选择器做成永久静态条目。** 否决：宿主会在运行时选择 native 或 browse 交互。静态包含不能修复通用的注册表竞争，也会破坏该选择模型。

## Consequences

每次读取启动图都会在当前 Loader 条目上执行一次有界协调。node half 回归测试覆盖不经生命周期事件而变为可见的条目，以及可写 profile 无法解析安装包时的打包裸条目。web 启动测试覆盖 renderer、workspace 与 picker 依赖链的激活。桌面打包仍必须包含这三个包的产物；协调器只会把活动的 Loader 条目暴露给浏览器。
