# Agent Note：桌面端回答完成通知

[English](2026-08-30-desktop-completion-notification.md) | 中文

状态：已实现

## 问题

模型运行期间用户可能离开桌面窗口，回答完成后没有可感知的提醒。

## 决策

Electron 主进程观察实时 `session/event` 并处理 `turn/end`。窗口未获得焦点且未销毁时发送系统通知并调用 Electron 平台提示音。完成、达到最大令牌数和错误结束会提醒；用户中止、取消和中断保持静默。

通知或音频失败会被隔离，操作系统限制不会影响宿主或会话生命周期。主进程拥有权威的窗口焦点和系统能力，因此不向持久化事件词汇新增事件。

## 验证

`apps/desktop/tests/completion-notification.spec.ts` 覆盖非激活窗口提醒、本地化文案、激活窗口静默、静默中断原因和系统不支持原生通知的情况。桌面端 TypeScript 编译已通过。
