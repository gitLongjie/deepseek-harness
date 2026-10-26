# Agent Note: the video workbench panel row follows the active locale

Status: implemented

English | [中文](2026-10-07-video-workbench-panel-row-follows-locale.zh.md)

## Problem

In a Chinese Web GUI the sidebar read 知识库, then 定时工作, then **Video workbench**. The third row is `sidebar.panellist` entry `video-workbench`, and it registered `label: en.title` — the English dictionary value, passed as a literal. `SlotLabel` accepts a string or a thunk precisely because registration happens once while the locale can change at any time, and the sidebar shell resolves the stored label through `resolveSlotLabel` on every projection and re-syncs on `ctx.locale.subscribe`; a literal is therefore frozen at load. `ui-schedule-work`, the sibling row, already passed the thunk.

The report arrived as a typeface complaint ("字体不是一个"): Latin and CJK glyphs resolve to different families in the UI font stack, so one English row beside Chinese rows reads as a different font rather than as untranslated copy. The page itself was already correct — its `<h1>` renders `t('title')` — which made the row look like a styling defect instead of a missing translation.

## Decision

The row registers a thunk reading the active dictionary, the `ui-schedule-work` pattern:

```ts ignore-check
const navLabel = (): string => {
  const dictionary = ctx.locale.getSnapshot().active === 'en' ? en : zh
  return dictionary.title
}
```

The same value feeds the row's visible text, its tooltip, and its `aria-label`, since the shell derives all three from the resolved label.

`tests/browser-plugin.client.spec.ts` now boots the browser half against the real `SlotRegistry` and locale service, declares the shell's `sidebar.panellist` and `main` slots, and asserts the resolved label is `Video workbench` under `en` and `视频工作台` under `zh`. That spec is what the package lacked: the page spec covers rendering from injected props and never touched the sidebar registration, so nothing read the registered label at all.

## Alternatives considered

- **Keep the literal and translate it in the shell.** Rejected: `resolveSlotLabel` is the one label path for every list slot (nav rows, tabs, settings sections), and a literal there is a value, not a key — teaching the shell to guess which literals are translatable would invent a second, ambiguous contract.
- **Re-register the row when the locale changes.** Rejected: `ui-sidebar` already re-projects on `ctx.locale.subscribe`, so a thunk is the mechanism the shell provides; re-registering would churn the slot ledger and the main-panel selection for a text change.

## Consequences

- The rail row, its tooltip, and its accessible name follow the active locale; the sidebar reads consistently in either language.
- A sidebar row that renders English beside Chinese neighbours is now a test failure rather than a visual judgement call.
- The row's icon still renders at the shell's 16px panellist size while the adjacent `sidebar.knowledge` row draws its own icon at 14px. That is a separate geometry question, left as it is.
