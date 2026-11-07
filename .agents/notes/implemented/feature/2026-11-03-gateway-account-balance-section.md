# Agent Note: Gateway account section with claw balance, and winner-based nav projection

Status: implemented

English | [中文](2026-11-03-gateway-account-balance-section.zh.md)

## Problem

The settings 账号与余额 page projected the upstream DeepSeek platform account only: `ui-settings-account` registers its section when a DeepSeek credential is stored, and its balance comes from the DeepSeek platform. In the claw deployment users sign into the gateway (`claw.deepagens.com`, a new-api lineage relay), the LLM runs on the gateway key, and the settings page had no account page at all unless a DeepSeek credential also existed — and never showed the gateway balance either way.

## Decision

**The login plugin owns the account page.** `ui-login` registers a `settings.section` entry under the upstream section's own id (`account`) at `priority: -1` — the same shadowing move the `settings.launcher` seat already uses (list slots resolve one winner per id cell, lowest priority renders; same priority would throw). The entry is live only while a gateway session is signed in: signed out it unregisters, and the upstream page (or no page, without a DeepSeek credential) serves the cell exactly as before the plugin existed. The component renders the session identity and the used and remaining token counts from the login store, so the session stays the single source shared by the gate, the launcher, and the page.

**Balance contract.** The gateway token quota reads from the new-api token-usage endpoint with the session key as the bearer credential: `GET /api/usage/token/` answers `data.total_used` and `data.total_available` as token counts, not display dollars. `data.unlimited_quota` true means the key has no remaining cap, and the page shows that instead of a remaining count. Reads run on sign-in, on launch-time session adoption, and on each entry into the settings page; a failed re-read keeps the last good value, a failed first read offers retry, and a sign-out during flight drops the result instead of publishing into the ended session.

**Nav projection follows the panel.** The settings shell's nav rows previously projected `entries('settings.section')` — the raw ledger — while the panel outlet renders `entriesOfSlot` (the winners). A shadowed registration would have shown two 账号与余额 rows selecting one panel. The projection now maps `entriesOfSlot`, so nav and panel agree; this also matches how `ui-sidebar` already projects its panellist.

**Models dictionaries restored.** The 2026-11 upstream merge kept this fork's pre-translation dictionaries in `ui-settings-models`, regressing eight languages to English copy and leaving upstream tests (which assert `模型`/`删除 {provider}？`) red. The translations were restored from the merge's upstream parent side, and this fork's newer keys (`followGatewayCatalog`, `followGatewayCatalogHint`, `inputText`, `modelInputInvalid`) got fresh translations; `advancedHint` keeps this fork's `settings.yaml` wording.

## Alternatives considered

**Extend ui-settings-account to render the gateway session.** Rejected: it would couple the upstream package to the login plugin (a seam type + optional hook across packages) for a fact its store already owns, and the registration condition lives there too, so the coupling would be structural, not cosmetic.

**Register the section under a new id (e.g. `gateway-account`).** Rejected: a DeepSeek credential would then surface two account pages; the deployment's account is the gateway one, and shadowing under the same id keeps exactly one page in both worlds.

**Read the balance in the component instead of the store.** Rejected: the session key and origin live in the store, and the launcher or future surfaces would re-implement the wire contract.

## Verification

`packages/client/ui-login` tests: the token-usage read reports used and remaining counts (and asserts the Bearer header on `GET /api/usage/token/`), an unlimited key does not surface a zero remainder as the cap, a 500, a non-JSON body, and a body that omits the counts report `unavailable`, a failed re-read keeps the ready value, sign-out during flight drops the result, logout resets to null, signed-out refresh is a no-op; component tests cover identity, `12,345` / `987,655`, the unlimited label, console/top-up links, and the retry affordance; the apply test asserts the registration options (`id: 'account'`, `priority: -1`), the shadowing winner over a same-id entry, and retirement on sign-out. `ui-settings-general`'s apply test asserts the winner-only projection (`阴影模型` row appears once, order-sorted). Dictionary restoration is verified by `tsc -b` (the zh mapped annotation and the `satisfies Record<keyof typeof en, string>` constraints enforce the key sets) plus a runtime key-set comparison across the eight dictionaries.

## Consequences

The settings account page now always mirrors the account that actually serves requests. Upstream `ui-settings-account` changes land without conflict; a future upstream priority at ≤ -1 would throw at registration (loud), not silently flip the shadow. The nav projection change applies to every section, so a future deployment shadowing any other section id needs no shell change. The account page shows the gateway's token counts from `GET /api/usage/token/` — used and remaining — rather than the billing endpoints' display dollars.
