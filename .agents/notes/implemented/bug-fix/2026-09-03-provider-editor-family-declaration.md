# Agent Note: Provider cards render the family the adapter declares

Status: implemented

English | [中文](2026-09-03-provider-editor-family-declaration.zh.md)

## Problem

The settings Models page rendered the Deepagens provider card as an "unknown layout" — only the "edit settings.yaml directly" hint, with no API-key field and none of the 30 gateway models the login flow had already stored. The editor picked its card from a hardcoded namespace table (`llm-deepseek`, `llm-pi-ai`), so a second adapter route sharing the DeepSeek section shape fell out of every curated card the moment it got its own namespace id.

## Decision

The configurable-provider directory entry carries the card family: `LlmConfigurableProvider.editorFamily`, declared by the owning adapter plugin (`llm-deepseek` declares `deepseek` for both its routes, `llm-pi-ai` declares `pi-ai`). The Models page threads that declaration through the directory join into `ProviderEditor`, which narrows it to its hand-written layouts and renders the advanced hint for a route whose adapter claims none. The namespace id is no longer a layout input.

## Alternatives considered

**Add `llm-deepagens` to the UI's namespace table.** Rejected because it cures one symptom and seeds the next: every future adapter namespace would need a UI commit to become editable, and the failure mode stays silent — a card that renders nothing but a hint.

**Derive the family from the section schema's shape.** Rejected because the shape answer is a heuristic (two families could overlap, one could change), while the adapter already knows which editor fits its config; the declaration is the fact, not a guess to be re-derived.

## Consequences

The Deepagens card now renders the deepseek-family editor — API key, base URL, and the gateway-seeded model list — with no UI change needed when its catalog changes. A new adapter namespace renders the hint until its plugin declares a family, which makes "forgot to declare" visible instead of silently uneditable.
