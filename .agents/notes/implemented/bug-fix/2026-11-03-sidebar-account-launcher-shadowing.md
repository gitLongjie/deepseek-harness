# Agent Note: One sidebar account launcher via slot shadowing

Status: implemented

English | [中文](2026-11-03-sidebar-account-launcher-shadowing.zh.md)

## Problem

The upstream merge left the sidebar foot with two account rows side by side: the login plugin's session row (the claw gateway account, previously registered into `sidebar.footer.action`) and the upstream `AccountMenu` (the DeepSeek credential view, registered into the settings shell's `settings.launcher` seat). Both rendered at the foot — the screenshot showed `brige | 已登录 DeepSeek` as one cramped line — and each carried its own menu.

## Decision

The login plugin's row moved onto `settings.launcher` and **shadows** the upstream launcher with `priority: -1` (ascending, lowest renders — the documented shadowing rule of `SlotCore.register`; same-priority would throw). The row keeps rendering the claw session's avatar and name; its menu gained a Settings entry wired to the seat's `openSettings` command beside the existing sign-out. `ui-settings-account` is unchanged: in compositions without the login plugin its `AccountMenu` still registers at the default priority and renders as before, and in this composition it stays registered but unrendered with no side effects (a shadowed single-seat entry's inject face is never instantiated).

An earlier draft deleted the upstream registration outright. Rejected: `apply.client.spec.ts` assembles the full webApp roster, where the login plugin occupies the seat regardless, so every occupancy assertion and the `operations()` helper had to learn about the other plugin anyway — and the deletion would resurface on every upstream merge. With shadowing, the upstream spec only needed identity-based assertions (`find(entry => entry.component === AccountMenu)`) instead of occupancy counts, which hold in both compositions.

The `sidebar.footer.action` seat and the ui-sidebar type dependency were dropped from the login plugin (package inject/peer/dev now name `dsh-client-ui-settings`).

## Alternatives considered

**Delete the upstream registration.** Rejected above: maximal merge friction for no runtime gain over shadowing.

**Repoint `AccountMenu`'s data at the claw session.** Rejected: it projects the DeepSeek credential/balance/profile stack (`useAccount`), a different session system; rewriting it would fork a live upstream component.

**Give the login row a menu entry that calls `contactUs`.** Deferred: the upstream contact flow reads the DeepSeek contact-config questionnaire; this OEM deployment has no feed configured for it. Settings + sign-out covers the row's needs.

## Verification

`packages/client/ui-login` tests cover the shadowing registration (`priority: -1` options), the settings menu item (`openSettings` called once, menu closed), and the session-identity menu reset. `apply.client.spec.ts` asserts this plugin's launcher by component identity, so it holds with and without the login plugin. Pre-existing, unrelated failures in the assembly (`settings.models.sign-in` hole has no declarer in the webApp roster; three ui-settings-general cases) fail identically on the pre-change tree.

## Consequences

One account row renders, showing the gateway session; upstream merges of `AccountMenu` land without conflict. A future priority change upstream (any value ≤ -1) would flip the shadowing and fail loudly as a same-priority throw, not silently.
