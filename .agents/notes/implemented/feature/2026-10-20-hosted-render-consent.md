# Agent Note: Paid H3 renders require explicit consent

Status: implemented

English | [中文](2026-10-20-hosted-render-consent.zh.md)

## Problem

A twenty-shot plan authored while the local ComfyUI backend was unconfigured froze `backend: "remote"` into every segment. Rendering then billed the hosted MiniMax API per generated second with nothing in the conversation asking for it, and the tool result echoed only the requested label, so "did this render on the GPU or on the paid API?" could not be answered from the record. The plan is the authority at render time, so fixing the composition afterwards changed nothing: the spend was already written into the document.

## Decision

- `video_plan` and `video_render` refuse any selection whose effective backend is `remote` unless the call carries `allow_remote=true`. The refusal names the segments and their total seconds, so the cost is a quantity the conversation confirms rather than a routing side effect. The plan-time half matters because the plan is what later renders read.
- A submitted segment reports `resolved` — the backend routing actually reached — beside `backend`, the policy the caller asked for. `auto` no longer hides where the work went.
- `auto` is not counted as paid by the guard. Routing resolves it at submission, and a deployment with no local backend is a configuration fact to report where it happens, not a per-call consent question.

## Alternatives considered

- **Warn in the result instead of refusing.** Rejected: a warning arrives after the spend is committed, because the task is already queued when the tool returns.
- **Count `auto` as paid as well.** Rejected: routing resolves `auto` per request, so a deployment with a working local backend would refuse every plan.

## Consequences

- A remote-only deployment passes `allow_remote=true` on both the plan and the render. That friction is the point: it is the only place the spend is acknowledged.
- `resolved` reaches the model and the session log with the result, so a replay shows where each segment actually rendered.

## Verification

- A paid render is refused before anything reaches the backend: no request is recorded and no job starts.
- `allow_remote=true` submits, and every submission reports `resolved: remote`.
