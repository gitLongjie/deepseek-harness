# Agent Note: Conversation-area pages stand each other down on open

Status: implemented

English | [中文](2026-09-20-conversation-area-pages-stand-each-other-down.zh.md)

## Problem

Three sidebar entries own a page over the conversation area: 知识库, 专家, and 定时工作流. The scheduled-work entry already switched — it is a layout main panel, and opening a browser page stood it down through `layout.selectPanel(null)` — but the exclusivity held in one direction only. The knowledge and expert pages kept two independent stores, and neither `openPage()` closed the other: opening 专家 while the knowledge page stood rendered both slots in `ConversationMainPanel`, the second page collapsed to zero height under the first's `height: 100%`, and the click changed nothing on screen. And selecting a global panel left the browser pages standing — with the scheduled-work page in the center, the knowledge row kept its highlight, so two nav rows lit at once, and the stale page re-appeared on returning to the Conversation. The entries covered instead of switched.

## Decision

Each browser page's navigation service owns two stand-down watchers beside its open-path exclusivity. Each `openPage()` stands its sibling down before opening: `UiKnowledgeService` closes the expert page, `UiExpertService` closes the knowledge page — the sibling is an optional mount, so the lookup is a per-use `ctx.get` with an inline structural type, the same rule `ui-conversation` applies to the pages' view sources, and neither plugin joins the other's `inject`. And `ILayout.onPanelSelection` now reports every committed `selectPanel` call to subscribers, so each service closes its page whenever a global panel is selected (returning to the Conversation is `null` and leaves the page as it is) — the same shape as the services' existing Session-navigation watcher. `ConversationMainPanel` keeps its both-stand render guard as defense only. At most one conversation-area page stands at any time, and the sidebar entries switch among the session surface, the knowledge page, the expert page, and the scheduled-work panel.

## Alternatives considered

**Coordinate in the renderer: render one page in `ConversationMainPanel`.** The stores would both stay open — the hidden page's nav row keeps its highlight, and closing the visible page resurrects the hidden one. State drift moves the bug instead of removing it.

**Stand the pages down in ui-sidebar's `selectPanel` action.** The sidebar row is only one writer today, and the shell would have to name each conversation-area page service. The pages' own services already own the close-on-Session policy, so the panel policy belongs there, fed by a layout report any future writer automatically carries.

**Make both pages layout main panels so the layout owns exclusivity.** The pages' Session-binding policy (any Session navigation closes them) and their conversation-area lifetime are page-local; hosting them in the layout needs a conversation-anchored panel class for two pages. A seam change sized for a two-line policy bug.

## Consequences

The knowledge, expert, and scheduled-work rows are mutually exclusive, and a sidebar highlight always names the page or panel on screen. Neither plugin hard-depends on another: with one page absent, the other keeps the single-page behavior the optional mounts already guaranteed, and `onPanelSelection` is additive to `ILayout`, so existing action-only consumers are untouched.

## Testing

`service.client.spec.ts` pins the layout reporting — committed selections reach the listeners, a disposer removes one, a rejected selection reports nothing, and disposal clears the rest. `browser-plugin.client.spec.tsx` and `apply.client.spec.tsx` pin each row standing its sibling and the scheduled-work panel down, both pages surviving a return to the Conversation, and the sibling-absent openings.
