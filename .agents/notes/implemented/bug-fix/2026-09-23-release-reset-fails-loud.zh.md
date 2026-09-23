# Agent Note: 桌面发布重置对删除与创建都做校验

Status: implemented

[English](2026-09-23-release-reset-fails-loud.md) | 中文

## Problem

重新发布桌面 v1.2.9 —— 把标签强推到多带一个修复的提交上——却静默保留了第一次构建的安装包。`Desktop publish` 运行全程报告成功，但每个 Release 资产仍带着第一次运行的 `updated_at`，下载端点提供的仍是第一次构建的字节。

`desktop-publish.yml` 把重置拆在两个并行 job 里。`create-release` job 负责删除并重建 release，但它的脚本把一切失败都当作可容忍：DELETE 的结果被 `|| true` 吞掉，创建的 POST 循环在若干次尝试后直接落出循环，从未检查是否有任何一次返回 201。随后 `build` job 跑 `electron-builder --publish always`，它自己按 tag 解析 release，并**跳过所有已存在同名的资产**。一个在删除中幸存的 release——GitHub 删除→创建的一致性窗口让这成为现实可能——就让上一次构建的安装包原样留在原地，而所有 job 依旧全绿。

## Decision

重置脚本对两端都做校验，且删除按 release 的数字 id 进行。第一次 fail-loud 运行后的事实是：按 tag 的删除已经移除了 release，而按 tag 的查找在超过脚本整整一分钟轮询窗口之后仍持续应答 HTTP 200——按 tag 的这对接口无法区分"release 幸存"与"过期应答"。脚本先解析出 id，按 id 删除，轮询该 id 直到返回 404，否则以退出码 1 结束；创建循环以 201 为退出条件，没有任何一次成功时以退出码 1 结束。`build` job 增加 `needs: create-release`，上传只会面对刚建好的空 release，不再与它赛跑。

## Consequences

标签重推现在要么用新构建替换 release 的资产，要么让重置 job 变红；静默的过期发布不再是可能的结果。删除被排序在任何上传之前，electron-builder 的跳过已存在资产行为只会看到它本应填充的空 release。

## Testing

Workflow 步骤由发布运行本身检验。本次变更后的 v1.2.9 重推就是验收用例：重置 job 必须打出 `release deleted` 和 `release created`，且每个资产的 `updated_at` 必须移动到该次运行的时间。
