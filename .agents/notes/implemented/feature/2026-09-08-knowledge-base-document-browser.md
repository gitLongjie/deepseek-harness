# Agent Note: Knowledge-base document browser

Status: implemented

English | [中文](2026-09-08-knowledge-base-document-browser.zh.md)

## Problem

The sidebar's knowledge-base section started a New Session on click, so users could name what the deployment exposes but never see inside a base. Tencent ima's library page sets the expected shape: select a base, read its documents as a table (名称/类型/更新时间), search it.

## Decision

The knowledge-base seam grows `listDocuments(baseId, query?)`, implemented by `dsh-kb-weknora` over `GET /knowledge-bases/:id/knowledge` (one page at the route's binding cap, backend keyword filter) and projected by `dsh-kb-gateway` as the `listDocuments` verb. The sidebar's collapsible base list is replaced by one knowledge entry row; clicking it opens the full knowledge page in the conversation area — base list beside the document browser (名称/类型/更新时间), with backend-filtered search, the deployment console action, and an ask action per base. `UiKnowledgeService` owns the ephemeral page state as an inject-hooks source on ConversationRoot; any Session navigation closes the page through a watcher on the Session list, so the Session surface always wins the conversation area. Any Session navigation closes the browser through a watcher on the Session list, so the Session surface always wins the conversation area.

The reactive source travels through ConversationInjected's hooks (the composerBlock channel) rather than a new GlobalStandardProps member — same reactivity, no props ripple across every other slot component's tests. ConversationRoot treats the hook as optional with a hook-free stand-in selector, because the ui-knowledge-base plugin is an optional mount.

## Alternatives considered

**A settings-style fixed overlay.** Rejected: a modal over the whole frame is not the referenced ima layout, which embeds the document table as a peer of the conversation.

**Keep session-start on the row and defer browsing again.** Rejected: users could name bases but never see inside them; the document table is the point of a knowledge library.

**Client-side filtering of one unfiltered fetch.** Rejected for search: the backend already matches titles and content per keyword, and the deployment, not the client, owns what matches.

## Consequences

Document previews, pagination beyond the first thousand-entry page, storage-quota footers, and ima-style personal/shared grouping remain deferred — the WeKnora API exposes no base grouping, and preview needs the document-content endpoints. The hook addition ripples one `useKnowledgeView` stub into every slot-component test mount, the same mechanical cost as earlier standard sources.

## Verification

Provider tests cover the document request shape (page bounds, encoded base id, keyword), field mapping with title/kind fallbacks, and the loud contract failures. Gateway tests cover the wire projection. Browser-pane tests cover states, search, ask, and back. Nav/page registration tests cover the injected shares, page-state transitions, and teardown; skeleton tests cover the page branch replacing the session area and its absence path.
