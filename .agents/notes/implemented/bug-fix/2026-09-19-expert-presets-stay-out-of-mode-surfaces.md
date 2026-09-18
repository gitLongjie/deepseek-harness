# Agent Note: Keep expert-marked presets out of the mode surfaces

Status: implemented

English | [中文](2026-09-19-expert-presets-stay-out-of-mode-surfaces.zh.md)

## Problem

The desktop ships the article-publisher and geo-optimizer experts as built-in agent presets, and an installed expert package syncs the same presets into the user preset root. Every roster surface therefore offered 深度云海文章专家 and GEO 优化专家: the new-session preset picker, the settings management section, and the expert market. The market already admitted only rows publishing card metadata, but the inverse rule was missing, so an expert appeared as a mode preset beside the modes — and the picker could start a session on a preset whose files an installed package's mount re-syncs on every host start.

## Decision

`category` in `preset.yml` is the committed expert marker, and one shared predicate — `isExpertPreset`, exported from `@deepseek-ai/dsh-agent-presets/display`, the inline-safe fold every client bundle may inline — now owns both directions of the rule. The new-session chip (`presetOptions`) and the management section exclude expert-marked rows; the expert market admits only them, replacing its inline `category` filter; and the header label keeps every healthy row (`presetDisplayEntries`) because it names a session already running an expert. The chip's opening value falls through to the first offered mode when the effective default is expert-marked, and a roster holding only experts renders the management section as unavailable. The wire row is unchanged: the split is presentation, so the Host projection stays the single fact source and hiring keeps resolving the preset by id.

## Alternatives considered

**Filter in the Host's `agentPresets/list` projection.** The four surfaces disagree — the market needs the expert rows and the label needs their names — so a server-side split either duplicates discovery into two faces or re-exposes the rows behind a parameter, all to move a `filter` call across the wire.

**Keep experts manageable in the settings section, gating each action.** The package shipping an expert re-syncs its files on every host start, so viewing, copying, or deleting the synced row would promise management its package owns; on the desktop the visible row is the system-trust built-in, which deletion refuses anyway.

**Share the predicate through the ui-agent-preset client entry.** The client bundle purity gate rejects every cross-plugin value import that is neither a declared module-table row nor an inline-safe fold, and a type-only import would erase before reaching the browser — so the predicate's home must itself be inline-safe, which is the presets domain's `display` fold.

## Consequences

Experts enter through the expert page only; the picker and the management section list mode presets, and the label still names hired-expert sessions. A user-root copy synced by an installed expert package now has no removal path in the preset surfaces — the market install channel's uninstall work owns that, as it already did on the desktop where the visible row was never deletable. `settings-store.client.spec.ts` and `section-store.client.spec.ts` pin the exclusion, the label's inclusion, and the expert-only roster's unavailable state.
