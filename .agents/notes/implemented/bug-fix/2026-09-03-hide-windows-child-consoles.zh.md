# Agent Note: 隐藏 Windows 子进程控制台

Status: implemented

[English](2026-09-03-hide-windows-child-consoles.md) | 中文

## Problem

桌面应用启动本地子进程时可能弹出瞬时的 Windows 控制台窗口，干扰图形界面使用。

## Decision

本地 subprocess provider 为每个子进程设置 Node 的 `windowsHide` spawn 选项。该选项在非 Windows 主机上无副作用，也不改变 stdio 路由或进程树归属。

## Alternatives considered

**在每个命令消费方中分别设置选项。** 否决，因为 bash、语言服务器、工作流及其他消费方共享本地 subprocess provider；逐个修复会遗漏其他启动路径。

**修改桌面可执行文件的 subsystem 或重定向全部输出。** 否决，因为问题发生在子进程创建时，而 stdio 是 subprocess seam 的既有组成部分，命令结果与交互会话仍需要它。

## Consequences

Windows 子进程不再通过 Node 的 spawn 路径请求瞬时控制台窗口。PTY 会话保留交互行为，非 Windows 的进程树行为不变。
