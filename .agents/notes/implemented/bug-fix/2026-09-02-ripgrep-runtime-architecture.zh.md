# Agent Note: 按运行时架构解析 ripgrep

Status: implemented

[English](2026-09-02-ripgrep-runtime-architecture.md) | 中文

## Problem

`@vscode/ripgrep` 加载器使用 `npm_config_arch` 选择可选的平台二进制文件。该变量描述安装目标，跨目标安装后仍可能留在智能体的运行环境中。过期值会使搜索工具选择错误架构的二进制文件，即使当前 Node 进程和宿主机上的 ripgrep 都可以正常运行。

## Decision

`dsh-tool-fs-search` 只在延迟导入 `@vscode/ripgrep` 期间将 `npm_config_arch` 设置为 `process.arch`，随后恢复原始环境项。随运行时提供的 sidecar 路径仍然优先使用。当运行时平台包确实不可用时，保留依赖自身的 unsupported-platform 错误作为回退。

## Alternatives considered

**保持信任 `@vscode/ripgrep`：** 否决，因为它的安装时覆盖值不能可靠表示运行时架构，并且在跨目标环境中会复现为搜索启动失败。

**使用 PATH 中的宿主机 `rg`：** 否决，因为搜索工具必须自包含，且 PATH 中的可执行文件不符合搜索安全模型和发布模型所要求的受控随包二进制文件。

**直接按 `process.arch` 解析可选包：** 否决，因为这会绕过依赖的平台代理逻辑，并破坏现有的延迟加载和失败诊断，包括测试中的模块替换。

## Consequences

搜索工具现在会选择与运行中 Node 进程匹配的可执行文件，同时保留仅使用随包二进制文件的策略。临时环境覆盖只在一次模块导入期间对进程可见，解析仍然是延迟且记忆化的；`finally` 清理会阻止覆盖泄漏到后续代码。回归测试覆盖 Windows x64 进程携带 `npm_config_arch=arm64` 的情况。
