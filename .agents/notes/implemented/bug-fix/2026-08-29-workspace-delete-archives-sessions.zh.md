# Agent Note：删除工作区时归档其成员会话

Status: implemented

[English](2026-08-29-workspace-delete-archives-sessions.md) | 中文

## 问题

删除 Workspace 此前只移除注册记录；其全部成员会话立刻脱离所有分组视图，重新出现在侧边栏的 Ungrouped 分组中。用户删掉不想要的工作区后，旧会话反而聚到「未分组」下，看起来像删除没有清理干净。客户端一侧无法自行修复：它得在删除 RPC 之前逐个调用会话动词，既没有原子性，也存在会话已经落入未分组的中间窗口。

## 决策

`WorkspaceRegistry.deleteKnown` 现在在移除注册的同一次提交状态写入中，把工作区的成员会话并入注册表级全局归档集合。成员资格使用实体的过滤版 `sessionIds` getter，只有通过 id 加规范 cwd 校验的会话进入集合；此前已被过滤（头部缺失、cwd 失效）的会话在删除前就是 Ungrouped 散会话，继续保持在外，以维持归档集合的已知会话不变量。Host 流在归档集合变化时本就发布 `host/archived-sessions-changed`，因此所有已连接客户端会扫走被归档的行——被归档的当前选中会话清入 New Session 视图——无需任何客户端改动。

## 已考虑的替代方案

**只解绑会话而不归档。** 否决：会话仍会落入 Ungrouped，正是反馈抱怨的界面。

**客户端在删除 RPC 前逐会话删除或归档。** 否决：非原子、需要 N 次往返，而且客户端 `ISessions` 接口本就没有删除动词。

**直接删除会话。** 否决：会话删除是另一个尚未提供的能力，且注册记录删除的既有决策保持会话日志归 Host 所有。

## 验证

`packages/workspace/workspace/tests/workspace.spec.ts` 覆盖删除把成员会话写入持久归档集合，同时目录与会话日志不受影响。`packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` 覆盖线上流程：删除先流出 `host/archived-sessions-changed` 再流出 `host/workspace-removed`，且 `workspace.list` 报告被归档的 id。`apps/web/tests/workspace-management.e2e.ts` 覆盖产品行为：通过对话框删除工作区后，其会话从所有分组视图消失，Ungrouped 分组随之收回，且状态在刷新后保持。

## 后果

删除工作区现在一步隐藏其全部会话；工作区消失后对会话取消归档会使其落入 Ungrouped，因为记账席位随工作区记录一起消亡。删除对话框文案说明归档结果。每次删除 Host 流会多发出一帧，顺序为先归档变化后移除。
