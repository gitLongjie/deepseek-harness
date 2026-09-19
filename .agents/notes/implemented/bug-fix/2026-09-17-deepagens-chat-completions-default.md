# Agent Note: Pin the Deepagens gateway route to chat completions over its seeded /v1

Status: implemented

English | [中文](2026-09-17-deepagens-chat-completions-default.zh.md)

## Problem

Generating through the Deepagens provider failed every request with the gateway's 404, `Invalid URL (POST /v1/v1/messages)`. The route's settings section installs the shared `llm-deepseek` Config schema, whose `protocol` defaults to `messages`; the login flow seeds the namespace's `baseURL` as `<origin>/v1`; and the Messages transport POSTs `{baseURL}/v1/messages`. The doubled `/v1` reached a gateway that serves only chat completions. Model discovery stayed green because it GETs `{baseURL}/models`, so the defect surfaced only at generation time, and the Deepagens card in the Models editor exposes no protocol control, so a user could not recover from the UI.

## Decision

The `llm-deepagens` composition base — the `installSection` entry in `packages/llm/llm-deepseek/src/index.ts` — carries `protocol: 'chat-completions'`. The base resolves below the user layer and above the schema default, so sections stored by earlier logins, which never contain `protocol`, resolve to chat completions without any migration, and an explicitly stored protocol still wins. The login flow keeps writing only `baseURL` and `models`: the wire protocol has one home, the composition base.

## Alternatives considered

**Write `protocol: 'chat-completions'` from the login mutation.** It would fix only future logins, and a user-layer value sits above every later composition default, so a later correction of the route's protocol would never reach pinned users; the same fact would live in two layers.

**Force the protocol with a Deepagens-specific schema (`z.const('chat-completions')`).** `z.const` rejects every other value, so a stored `protocol: 'messages'` would fail the whole section's validation and strand the namespace on its last-good snapshot instead of healing it.

**Trim a trailing `/v1` in the Messages transport.** Path surgery masks one mismatched suffix while both namespaces stay on a protocol the gateway does not serve; the protocol, not the URL text, is the owning fact.

## Consequences

Deepagens generation POSTs `{baseURL}/chat/completions`, matching the gateway's OpenAI-compatible face, and catalog discovery and generation address the same endpoint. `packages/llm/llm-deepseek/tests/dynamic-config.spec.ts` pins the wire path `/v1/chat/completions` through a seeded `/v1` base URL and one assembled request, and fails against the old default. Should the gateway gain an Anthropic-compatible face, an explicit user-layer `protocol: 'messages'` selects it — the layering keeps that reachable without a code change.
