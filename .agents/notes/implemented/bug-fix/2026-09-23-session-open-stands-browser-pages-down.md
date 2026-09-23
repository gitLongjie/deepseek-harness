# Agent Note: Opening a Session stands the browser pages down

Status: implemented

English | [中文](2026-09-23-session-open-stands-browser-pages-down.zh.md)

## Problem

From the expert page, clicking a chat in the sidebar did nothing when the clicked chat was the session the user came from: the expert market stayed over the conversation area, so the click appeared dead. The pages close on Session navigation through a watcher that compares `list.current` across notifications (`watchSessionNavigation`), but re-selecting the current Session writes no `current` change — `manager.select` assigns the same id and the projection notifies with it unchanged — so the watcher returned early and the page stood. The knowledge page's mirrored watcher carried the same gap, and so did 新会话 when the flow reused the workspace's blank placeholder session already on screen. The knowledge, expert, and scheduled-work rows switched correctly (fixed in 2026-09-20-conversation-area-pages-stand-each-other-down); the session rows did not, because their close signal keys on a change rather than on the navigation command.

## Decision

`UiWorkspaceService.openSession` — the one service whose contract is "select a Session and show its Conversation as one UI navigation action" — now stands both conversation-area pages down itself, beside `layout.selectPanel(null)`: a per-use `ctx.get` of `uiExpert` and `uiKnowledge` with an inline structural type, the optional-mount pattern those pages apply to each other in `openPage()` and ui-conversation applies to their view sources. The command-based stand-down covers the re-selection the watcher cannot see; the watcher keeps closing the pages for every `current` change it does see (open, archive-clear, New Session with no target, startup restore). The stand-down sits after `sessions.open`, so a refused selection changes nothing, matching the panel rule in the throw test.

## Alternatives considered

**Close the pages from their own watchers on any list notification.** The list store also notifies for background traffic — activity, status, projection refreshes — so the pages would close while the user reads them, with no Session navigation anywhere.

**Report session navigation through `ILayout`** (an `onSessionNavigation` beside `onPanelSelection`). A new layout surface owned by a service that does not perform session navigation; every future session-opening writer would have to remember to report, where `openSession` is already the funnel the rows, the hero picker, and New Session flow through.

**Make `ClientSessions.open` emit a selection event.** A controller-face change for a presentation policy, with SDK and snapshot projections to carry for it.

## Consequences

Every chat-row click and New Session flow lands on the session surface, including the re-selection case; the sidebar highlight and the visible page always agree. No plugin gains a dependency: both lookups stay per-use optionals, and with either page plugin absent the navigation behaves as before.

## Testing

`workspaces-service.client.spec.ts` pins the stand-down on a re-selection of the current Session (both `closePage` spies fire) and the navigation holding while either page plugin is absent; the existing throw test keeps pinning that a refused selection stands nothing down.
