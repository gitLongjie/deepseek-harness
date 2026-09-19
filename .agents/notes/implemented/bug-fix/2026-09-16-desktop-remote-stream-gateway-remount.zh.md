# Agent Note: 在打开 Remote 流前等待桌面 Gateway 重新挂载

Status: implemented

[English](2026-09-16-desktop-remote-stream-gateway-remount.md) | 中文

## Problem

当桌面配置实时重载暂时撤下 `typertGateway` 时，Electron renderer 可能正在打开 Typert Remote 流。拒绝该 IPC 调用会让 renderer 报告连接丢失并启动重试循环，尽管 Host 仍在正常恢复。

## Decision

`apps/desktop/src/main/ipc/transport.ts` 为 Remote 流打开操作接收一个 Gateway 等待器。当前 Host 没有 Gateway 时，打开处理器会保持等待，直到桌面入口观察到下一次 `typertGateway` 的 `internal/service` 发布。得到的 Gateway 会与尚未认领的流一同保存，并在 renderer 认领其 ID 后泵送该流，因此第二次服务变化不会将该流转交给另一个提供者。

## Alternatives considered

**Renderer 重试。** 现有重试会把正常的 Host 服务重新挂载当成传输失败，产生可见警告并重复连接工作；Host 拥有服务可用性，可以等待其权威发布事件。

**固定启动延时。** 延时既不观察服务状态，也不能覆盖后续配置重载，因此在激活较慢时仍可能失败，并会无谓地延迟已就绪的 Host。

## Consequences

Remote 流创建会在 Gateway 不可用的短暂窗口内等待，而不会拒绝给 renderer。永久失败的 Host 可能让请求保持等待直到 Electron 关闭；应用关闭拥有该进程生命周期。桌面 transport 测试使用受控的 Gateway 发布，验证在服务缺席期间开始的打开操作只会在替代服务发布后完成。
