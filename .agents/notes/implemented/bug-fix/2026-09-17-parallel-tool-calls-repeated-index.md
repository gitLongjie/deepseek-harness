# Agent Note: Split parallel tool calls a gateway packs under one repeated chat-completions index

Status: implemented

English | [中文](2026-09-17-parallel-tool-calls-repeated-index.zh.md)

## Problem

Parallel tool calls through an OpenAI-compatible gateway failed with `invalid arguments: "arguments" must be an object` on every attempt. The chat-completions translator buckets streamed `tool_calls` fragments by wire `index`, and a gateway that never advances `index` across parallel calls concatenated the calls' argument fragments into one block — recorded session evidence shows argument text like `{"pattern": "a"}{"pattern": "b"}`. `JSON.parse` rejected the text, the loop surfaced the INVALID_ARGS failure, and the model kept retrying the same shape it had already emitted.

## Decision

`translate` (`packages/llm/llm-deepseek/src/protocols/chat-completions/translate.ts`) opens a new harness block when a delta carries a fresh `id` or fresh `function.name` that disagrees with the open block its index maps to. Identity fields stream once per call, so a disagreeing value marks another call rather than a continuation, and the index slot rebinds to the new block for that call's later fragments. The translator already treats `''`/`null` identity fields as "unchanged", so a continuation delta never trips the split.

## Alternatives considered

**Require the gateway to advance `index`.** The OpenAI-correct behavior, but the adapter speaks to many OpenAI-compatible endpoints, including gateways re-encoding other vendors' models; the client-side split repairs the whole class and extends the file's existing tolerance for degenerate identity fields.

**Split concatenated argument text at parse time.** `JSON.parse` recovery in the agent loop cannot distinguish two concatenated objects from one legitimate object containing `}{`; the owning facts are the streamed identities, so the decision belongs in the translator that sees them.

## Consequences

Parallel tool calls through index-collapsing gateways execute as separate calls, and fragmented single calls behave as before — no legitimate shape splits, because a split requires a disagreeing fresh identity field. `translate.spec.ts` pins both split shapes: a fresh `id`, and a fresh `name` under the `''` id repetition. A second call that carries neither field cannot be split at this layer; its fragments still concatenate into the first call's arguments.
