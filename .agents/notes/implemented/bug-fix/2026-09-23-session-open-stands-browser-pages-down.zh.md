# Agent Note: 打开会话时让浏览器页退位

Status: implemented

[English](2026-09-23-session-open-stands-browser-pages-down.md) | 中文

## Problem

在专家页点击侧边栏里的聊天时，如果点的是进入专家页之前的那个会话，点击毫无效果：专家市场仍覆盖着会话区。页面靠一个 watcher 在会话导航时关闭自己——它跨通知比较 `list.current`（`watchSessionNavigation`）——但重新选择当前会话不会写入 `current` 变化：`manager.select` 赋的还是同一个 id，投影带着它原样通知，watcher 提前返回，页面继续停留。知识库页的同形 watcher 带着同样的缺口；新会话在流程复用工作区的空白占位会话（正是屏幕上那个）时也一样。知识库、专家、定时工作流三行本身切换正常（见 2026-09-20-conversation-area-pages-stand-each-other-down）；会话行不是，因为它们的关闭信号依据的是「变化」而不是「导航命令」。

## Decision

`UiWorkspaceService.openSession`——契约就是"选择一个会话并把它的会话界面作为一个 UI 导航动作展示出来"的唯一服务——现在在 `layout.selectPanel(null)` 旁边自己让两个会话区页面退位：按使用逐次 `ctx.get` `uiExpert` 与 `uiKnowledge`，配内联结构类型，与两个页面在 `openPage()` 里互相退位、ui-conversation 解析它们 view 源时所用的 optional-mount 模式一致。基于命令的退位补上了 watcher 看不见的重选场景；watcher 继续为它看得见的每次 `current` 变化关页（打开、归档清空、无目标的新会话、启动恢复）。退位放在 `sessions.open` 之后，选择被拒绝时什么都不变，与 throw 测试固化的面板规则一致。

## Alternatives considered

**由页面自己的 watcher 在任意列表通知时关页。** 列表 store 也会为后台流量通知——活动、状态、投影刷新——用户在读页面时页面就会自己关掉，而期间没有任何会话导航。

**通过 `ILayout` 上报会话导航**（在 `onPanelSelection` 旁边加 `onSessionNavigation`）。为不执行会话导航的服务新开一层 layout 面；今后每个打开会话的写入方都得记得上报，而会话行、hero 选择器、新会话流程今天都汇入 `openSession` 这一个漏斗。

**让 `ClientSessions.open` 发出选择事件。** 为了一个呈现策略改控制器面，还要拖着 SDK 与快照投影一起改。

## Consequences

每次聊天行点击和新会话流程都落在会话界面上，包括重选场景；侧边栏高亮与可见页面永远一致。没有插件新增依赖：两处查找保持按使用逐次的 optional，任一页面插件缺席时导航行为与从前相同。

## Testing

`workspaces-service.client.spec.ts` 固化了对当前会话重选时的退位（两个 `closePage` spy 各触发一次），以及任一页面插件缺席时导航照常成立；既有 throw 测试继续固化选择被拒绝时什么都不退位。
