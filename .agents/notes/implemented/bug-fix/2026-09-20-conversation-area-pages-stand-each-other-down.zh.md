# Agent Note: Conversation-area pages stand each other down on open

Status: implemented

English | [中文](2026-09-20-conversation-area-pages-stand-each-other-down.md)

## Problem

左侧三个入口各拥有一个覆盖会话区的页面：知识库、专家、定时工作流。定时工作流已经是切换——它是布局主面板，打开任一浏览器页时也通过 `layout.selectPanel(null)` 让它让位——但这份互斥只有单向。知识库页与专家页各自持有独立的状态存储，任何一方的 `openPage()` 都不会关闭对方：在知识库页打开时点击专家，`ConversationMainPanel` 会同时渲染两个槽位，后一个页面在前者的 `height: 100%` 下被压成零高度，点击在屏幕上毫无变化。而选中全局面板时浏览器页继续驻留——定时工作流页面占据中央时知识库行仍保持高亮，两行同时点亮；回到会话界面时残留页面又会重新出现。这些入口表现为覆盖，而不是切换。

## Decision

每个浏览器页的导航服务在打开互斥之外还持有两个让位监视器。每个 `openPage()` 在打开自身之前让兄弟页面让位：`UiKnowledgeService` 关闭专家页，`UiExpertService` 关闭知识库页——兄弟插件是可选挂载，因此查找采用逐次调用的 `ctx.get` 加内联结构类型，与 `ui-conversation` 解析两个页面视图源是同一条规则，任何一方都不把对方加进自己的 `inject`。同时 `ILayout.onPanelSelection` 现在把每次已提交的 `selectPanel` 调用报告给订阅者，因此任一全局面板被选中时每个服务都会关闭自己的页面（回到会话界面对应 `null`，页面保持原状）——与两个服务既有的 Session 导航监视器同构。`ConversationMainPanel` 保留两者同立时的渲染护栏，仅作防御。任意时刻至多一个会话区页面站立，侧边栏入口在会话面、知识库页、专家页与定时工作流面板之间切换。

## Alternatives considered

**在渲染器里协调：由 `ConversationMainPanel` 只渲染一个页面。** 两个状态存储都会保持打开——被隐藏页面的导航行保持高亮，关闭可见页面会让隐藏页面复活。状态漂移只是挪动了缺陷，没有消除它。

**在 ui-sidebar 的 `selectPanel` 动作里让页面让位。** 侧边栏行今天只是众多写入方之一，而且 shell 将不得不逐一指名每个会话区页面服务。页面自己的服务已经持有“Session 导航即关闭”的策略，面板策略理应放在同一处，由布局的报告供给，未来任何写入方都自动携带。

**把两个页面都改成布局主面板，让布局持有互斥性。** 页面的 Session 绑定策略（任何 Session 导航都关闭页面）与会话区生命周期都是页面本地的；交给布局就要为两个页面引入锚定会话区的面板类。为两行策略缺陷做的接缝改造，不划算。

## Consequences

知识库、专家与定时工作流三行互斥，侧边栏高亮始终命名屏幕上的页面或面板。插件之间互不硬依赖：缺省任一页面时，另一方保持可选挂载本就保证的单页行为；`onPanelSelection` 对 `ILayout` 是增量式添加，既有只调用动作的消费方不受影响。

## Testing

`service.client.spec.ts` 固定布局的报告行为——已提交的选择到达监听器、解绑器移除单个监听器、被拒绝的选择不报告、布局释放清空其余监听器。`browser-plugin.client.spec.tsx` 与 `apply.client.spec.tsx` 固定两行各自让兄弟页面与定时工作流面板让位、两个页面在回到会话界面时保持原状，以及兄弟缺省时的打开行为。
