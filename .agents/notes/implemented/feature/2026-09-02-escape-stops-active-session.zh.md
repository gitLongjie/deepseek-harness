# Agent Note: 使用 Escape 停止当前 Session

Status: implemented

[English](2026-09-02-escape-stops-active-session.md) | 中文

## Problem

对话 composer 已经通过指针控件提供 Stop，但用户无法通过键盘终止当前正在运行的 Session。Escape 同时参与弹层和输入法处理，因此新增的停止手势必须保留这些更高优先级用途。

## Decision

Lexical composer keymap 会在 Escape 未被弹层仲裁消费且当前 Session 正在运行时调用已有的 Stop 注入操作。输入栏会报告是否实际消费了该手势，因此锁定、缺少 Session 或非运行中的 Session 会让 Escape 保持未消费。输入法组合态中的 Escape 专用于取消组合态，不会停止 Session。

## Alternatives considered

**新增 document 级键盘监听器。** 不采用：当前 composer 已经拥有获得焦点的 Escape 命令层，以及正确排列手势所需的弹层、组合态和 Session 状态。

**在弹层仲裁之前停止。** 不采用：Escape 必须能够关闭打开的弹层，同时不能顺带终止正在运行的 Session。

## Consequences

用户在 composer 获得焦点时可以使用 Escape 停止当前运行的 Session，现有 Session Controller 取消路径仍是唯一的停止实现。弹层关闭和输入法组合态取消继续拥有更高优先级。composer 之外的 Escape 仍可交给浏览器和其他 UI 行为处理。
