# Agent Note: the login catalog stores only the capacities the gateway declares

Status: implemented

English | [中文](2026-09-27-ui-login-stores-only-declared-capacities.zh.md)

## Problem

`LoginStore.syncCatalogFromGateway` mapped every discovered model with `contextWindow: m.contextWindow ?? 128_000` and `maxTokens: m.maxTokens ?? 4096`. A gateway whose `GET /v1/models` listing omits the capacity extensions therefore signed in to a catalog in which every row claimed a 128k window and a 4k output cap — numbers the endpoint never declared. The Deepagens deployment saw exactly this: the management side's model records carry `context_length`, but the login-pulled catalog showed a uniform 128k, and the fabricated values were stored as durable facts that survived until a catalog change rewrote them.

## Decision

A catalog row carries only the capacities the listing declared. Absent `contextWindow`/`maxTokens` stay absent: the `llm-deepagens` section schema already treats both fields as optional and validates them only when present, the request path resolves the gap from the route's `defaultContextWindow` (1M) and `maxTokens` (256k), and the Models page renders its "uses the provider default" placeholder instead of a fabricated number.

## Alternatives considered

**Keep the fallback.** Rejected: it persists a made-up fact at the point where the product stores durable model metadata, and every downstream consumer (capacity steering, context-pressure metering, the Models page) then reasons from a number no endpoint stands behind. A silent endpoint should look silent.

**Teach discovery to parse more wire shapes** (numeric strings, per-endpoint nested metadata). Rejected: no observed gateway produces them — the claw gateway emits integer `context_length`/`max_output_tokens`, and `capacity()` already reads both its spellings. Widening the parser without a producer would be dead tolerance.

## Consequences

- A deployment whose listing omits capacities now stores capacity-less rows; the request-time window falls back to the route default (1M, configurable via `defaultContextWindow`) instead of the fabricated 128k.
- The first sign-in after this change rewrites a stored catalog that carries the old fabricated numbers, because the computed rows differ from the stored ones.
- Gateways that declare capacities (the current claw gateway does) are unaffected: declared values land exactly as before.

## Testing

The login-models spec's mixed listing now expects the capacity-less model to be stored without `contextWindow`/`maxTokens`, and a focused case pins a fully silent listing (`id`/`name` only) as capacity-less rows.
