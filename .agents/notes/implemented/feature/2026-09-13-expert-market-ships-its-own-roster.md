# Agent Note: The expert market ships its own curated roster

Status: implemented

English | [中文](2026-09-13-expert-market-ships-its-own-roster.zh.md)

## Problem

The expert page initially rendered the deployment's agent-preset roster, read through the Host's `agentPresets` Remote face. Every composed preset then appeared as a hireable expert card, including mode presets such as 标准模式 — session-composition choices, not products on a market page. The remote read also gave the page's content three fallback paths (the invocation-unavailable refusal, an empty deployment roster, an unwired inject), all answering mock data, so what the page showed depended on deployment composition and failure behavior rather than on a decided catalog.

## Decision

The expert market's content is `ui-expert`'s own curated roster (`MOCK_EXPERT_PRESETS` in `src/client/mock-data.ts`): featured scenario banners plus hireable expert cards across several categories. The page inject no longer declares `remote` or `remote.agentPresets`, `load` answers that roster directly, and the package drops its `@deepseek-ai/dsh-api-remotes` dependency, devDependency, and tsconfig reference. Hiring is unchanged: it forwards the card's preset id to the ui-agent-preset staging service and starts the next session. This supersedes the consumption half of [the expert-card-metadata decision](2026-09-13-expert-card-metadata-on-agent-presets.md): the `preset.yml` card fields keep flowing through discovery, the Remote projection, and authoring copies, but the preset surfaces own the roster and the market no longer renders it. Wiring the market to a deployment-managed registry returns with the marketplace install channel and its trust tier.

## Alternatives considered

**Keep the Remote-fed roster and filter out mode presets.** Rejected: a deployment composes arbitrary presets, and no field distinguishes a hireable expert from a mode preset, so every heuristic (default flag, metadata presence) fails in some deployment, and the three fallback paths remain.

**Leave the market empty until a real registry exists.** Rejected: the page exists to exercise the market experience end to end — browse, filter, hire — and an always-empty catalog removes the surface those flows need.

## Verification

`apply.client.spec.tsx` asserts `load` answers the shipped roster and that a hire stages the forwarded id before the session starts; the Remote stubs are gone, and the package manifest declares no `@deepseek-ai/dsh-api-remotes` dependency.

## Consequences

Every deployment renders the same decided catalog with no remote read and no fallback branches; the page's empty state is unreachable until a registry replaces the shipped roster.
