# Agent Note: The expert market reports a broken expert instead of hiring into silence

Status: implemented

English | [中文](2026-09-23-expert-market-reports-broken-experts.zh.md)

## Problem

"Clicking hire does nothing, and the expert never shows up" — the expert market admitted every roster row that publishes card metadata (`isExpertPreset` checks `category` alone), including rows the host reports `broken` because their composition cannot mount. A broken expert rendered a fully hireable card; the hire staged a preset that can never compose, `startSession` failed at preset validation, and the only trace was the renderer's `console.warn('new session failed: …')` — invisible in the product. The 2026-09-18 desktop incident (the `text:`→`prefix` persona rename leaving every deployment expert unmountable) produced exactly this symptom, repeatedly, with no surface ever saying why. The mode surfaces already exclude broken rows (`presetOptions`); the market was the one roster surface without a health rule.

## Decision

The market keeps broken expert rows but renders them honestly: `ExpertRecord` carries the roster's `broken` verdict, and `ExpertBrowser` shows the reason on the card with the hire action disabled. Hiding the row would report the misconfiguration to nobody — the market is the only surface that advertises a shipped expert — so the card is where the deployment learns its expert cannot be hired. This mirrors the failing-loud rule for misconfiguration while keeping the discovery the card exists for.

The hire flow itself (stage → session start → the seat applying the staged pick when the blank session becomes current) is now pinned by a cross-package integration spec in `ui-expert` that mounts the real ui-agent-preset plugin over controller doubles; the hop between the two packages had no coverage before.

## Alternatives considered

**Exclude broken rows from the market.** One filter, matching `presetOptions` — but the settings section excludes expert rows by design, so a hidden expert is invisible everywhere while the deployment still ships and advertises it. Silence is the failure being fixed.

**Surface the hire flow's later failures (session-create rejection, staged-apply refusal) as user-visible toasts.** Worth doing — the create failure still only reaches the console — but it spans ui-workspace's generic new-session path and the seat's refusal state, and fixes neither the broken card nor the discovery gap. Recorded as a follow-up, not a substitute.

## Consequences

A deployment with an unmountable expert sees that expert's card disabled with the host's reason instead of a hire that silently does nothing. Healthy experts are unaffected: the hire flow is unchanged, and a healthy roster renders exactly as before. Machines that carried the 2026-09-18 stale `text:` persona key in `~/.dsh/.agent-presets/<id>/` must still rename that key by hand (see 2026-09-18-desktop-persona-preset-prefix-key) — this note only makes the next such misconfiguration visible.
