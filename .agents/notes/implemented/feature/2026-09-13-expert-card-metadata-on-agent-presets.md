# Agent Note: Expert cards ride the preset roster, not a new expert registry

Status: implemented

English | [中文](2026-09-13-expert-card-metadata-on-agent-presets.zh.md)

## Problem

The product wants an expert center: cards a user browses, hires onto a session, and defaults new sessions to. The tempting shape is a parallel `expert` domain — its own package, service, prompt contributor, and session binding — but the harness already composes per-session agents from agent presets, and a preset directory already carries a persona row, preset-local skills, and a display-metadata file. A second mechanism would fork the three facts an expert consists of across two registries and would need its own session-log vocabulary to stay model-visible ⟺ logged.

## Decision

An expert is an agent preset that publishes richer display metadata; this change extends `preset.yml` with the expert-card fields — `category`, `tags`, `quickPrompts`, `icon` — and carries them through the existing pipeline and nothing else. `readPresetMetadata`/`renderPresetMetadata` accept and cap the fields (eight tags, three quickPrompts, a short glyph) under the file's standing degrade-to-empty contract, discovery spreads them onto `AgentPreset` rows, the Remote `list` projects them onto path-free `AgentPresetRow`s, and `copyComposition` travels them into authoring copies so a forked expert presents like its source while `name`/`order` stay copy-distinguishing. The desktop's reference expert (`apps/desktop/config/agent-presets/geo-optimizer/`) demonstrates the whole convention: a persona row stating the diagnostic-before-quote methodology, a preset-local pricing skill mounted through `customSkillDirs`, and the card metadata in `preset.yml`.

## Alternatives considered

**A `packages/expert/` host service with its own prompt contributor and skill binder.** Rejected: the persona row and preset-local skill roots already inject both, and a second prompt contributor would compete with `dsh-persona` over section order. Session binding already exists as the `agent-preset/selected` projection; a `session.metadata.expert` field would be a second source of truth for the same fact.

**An `expert.yml` beside `preset.yml`.** Rejected: two metadata files on one directory is two homes for display text; the pre-release stance allows extending the existing file freely.

## Verification

`metadata.spec.ts` covers reading, degrading, capping, and round-tripping the new fields; `discovery.spec.ts` asserts they surface on scanned rows; `remote.spec.ts` asserts the roster projects them; `authoring.spec.ts` asserts a copy travels them while still dropping `name`/`order`.

## Consequences

A market-style picker can group, filter, and render hire affordances from roster rows alone. Install-from-registry stays the one future host-side addition, and it inherits the open trust question: a composition is executable (`!!js`), so an install channel must come with its trust tier and a `!!js` policy before it ships. The shipped market page stopped rendering roster rows — [the curated-market decision](2026-09-13-expert-market-ships-its-own-roster.md) owns where the page's content comes from; the metadata pipeline stays for the preset surfaces.
