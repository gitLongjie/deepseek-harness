# Agent Note：恢复末尾分组表头并把它命名为任务

Status: implemented

[English](2026-09-21-tasks-group-header-and-label.md) | 中文

## 问题

侧边栏末尾的分组收纳没有任何 Workspace 记账的 Session。桌面分支曾移除该分组的表头行——散会话尾部直接渲染在最后一个 Workspace 文件夹之下、没有任何标题。由此产生两个后果。其一，在 GUI 的 Workspace 流程之外创建的 Session（CLI、SDK、IM 绑定，或规范 cwd 从未 attach 过的种子历史）会作为一条无标题行出现在不相干的 Workspace 之下，没有任何东西说明它是谁、在哪个目录运行；侧边栏的悬停卡片与行布局本身也都不显示 cwd。其二，录制快照 `snapshots/web/message-actions/fork.expected.md` 与两个 `WorkspaceBrowser` 用例仍在描述表头行和 `.slice(1)` 的 treeitem 偏移，因此无密钥回放通道是红的。

该分组的文案同样被否决：未分组 / Ungrouped 描述的是这个分组缺少什么，而不是它装着什么。

## 决策

未分组分组重新渲染表头行：分组自己的展开开关、不提供分组菜单、＋ 为惰性——Session 只能在真实 Workspace 中新建，因此尾部的 ＋ 绝不能从一个不拥有目录的分组回退到当前或最近的 Workspace。`deriveGroups` 也重新像其他分组一样读取该分组的持久化展开标志，因此表头开关与「为选中 Session 自动展开」的副作用都会作用于它。

该分组的标签在简体中文中为**任务**、在英文中为 **Tasks**，在两个命名它的字典中同步修改：`ui-workspace` 的 `group.ungrouped`（侧边栏表头、分组操作的 accessible name，以及搜索结果行回退的 Workspace 标签）与 `ui-settings-unarchive-sessions` 的 `ungrouped`（已归档会话页面中「所属 Workspace」列）。分组的代码身份不变：`tree.ts` 的 `UNGROUPED_KEY`、浏览器本地顺序记账键与字典键名都仍写作 ungrouped。

## 已考虑的替代方案

**保留无表头尾部，只改标签。** 没有表头，这个标签就没有落点，而这些行仍会被读成上一个 Workspace 的成员。

**只在侧边栏里命名该分组。** 已归档会话页面为同一批 Session 命名同一个分组，一个产品概念会因此带两个名字。

**让尾部的 ＋ 回退到当前或最近的 Workspace。** 不带 Workspace 的 `startSession` 会继承当前选中或最近使用的 Workspace，于是这个 ＋ 会在它所在行并未指明的目录里创建 Session。

**把未分组行藏到「单列表」分组模式之后。** 不属于任何 Workspace 的 Session 是普通的产品历史，只在切换视图模式后才可达会让它们更不可见，而不是更可见。

## 验证

`pnpm exec vitest run packages/client/ui-workspace packages/client/ui-settings-unarchive-sessions` 覆盖恢复后的行为：`workspace-browser.client.spec.tsx` 固定散会话当前选中时自动展开的「任务」表头、缺失的分组菜单、惰性的 ＋，以及拖拽重排时表头行在渲染树中的位置；`tree.client.spec.ts` 覆盖未分组分组的派生与展开标志；`rows.client.spec.tsx` 覆盖表头不渲染 Workspace 菜单。`packages/client/ui-settings-unarchive-sessions/tests/components.client.spec.tsx` 固定已归档会话页面上的任务标签。

`DSH_SNAPSHOT=replay pnpm run test:web` 回放 `message-actions` 场景，其 fork 快照重新在种子 Session 之上列出末尾分组表头。

## 后果

不属于任何 Workspace 的 Session 重新作为一个被命名的分组可见，并会为选中的 Session 展开。该分组不提供重命名、删除、在资源管理器中打开或新建操作，因此其中的任何东西都无法作用于它并不拥有的目录。`delete.desc` 文案仍告诉用户删除 Workspace 会归档其 Session，这正是 Host 的行为；标签变更不改变成员关系、排序、归档或 Workspace 注册表的 attach 规则，因此 Session 仍只能通过 `attachSession` 加入 Workspace。
