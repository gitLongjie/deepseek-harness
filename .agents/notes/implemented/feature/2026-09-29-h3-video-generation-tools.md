# Agent Note: H3 video generation tools

Status: implemented

English | [中文](2026-09-29-h3-video-generation-tools.zh.md)

## Problem

DeepSeek Harness had no way to generate video from a conversation. MiniMax H3 shipped open weights that run locally through ComfyUI and a hosted V2 API, but neither surface was reachable from an agent session, and no seam existed to route between a local GPU backend and the hosted API.

## Decision

Two experimental packages ship the capability.

`@deepseek-ai/dsh-experimental-h3-video` is the capability seam: an `H3Video` Service Definition with three roles. The providers are `createComfyUIProvider` (local queue, template filling, `/prompt` + `/history` polling, `/view` download, `/interrupt` cancel) and `createMiniMaxApiProvider` (hosted V2 creation, task polling, time-limited URL download). Each provider owns its transport and file download; neither owns retry policy or routing. Routing is one explicit function, `resolve`, that picks `local` / `remote` / `auto` per segment and always validates the request against the chosen backend's declared capabilities before submission. `assembleVideo` concats ordered segment files with ffmpeg into one uniform h264/yuv420p/24fps mp4. All tunables are validated `Config` fields.

`@deepseek-ai/dsh-experimental-tool-video` is the consumer: three model-facing tools over `ctx.h3Video`. `video_plan` structures a conversation request into a versioned storyboard persisted as a JSON artifact under the output directory; `video_render` submits each selected segment to the routed backend and starts one `h3-video`-kind background job per segment that polls to completion; `video_assemble` reads the deterministic `segments/<planId>-<segmentId>.mp4` files in plan order and concatenates them. The `h3-video` job kind extends `JobKindMap` by declaration merging.

Plans are file-backed, not session events. A `video/plan` event would require the persistence catalog and session-format version machinery; instead the plan content appears verbatim in the `video_plan` tool result, so session replay reconstructs what the model saw, and the artifact itself lives under `outputDir/plans/`.

Downloads land under the DSH cache `video` directory by default (`$DSH_HOME/cache/video`, resolved through `@deepseek-ai/dsh-home-paths`), and every submission preflights the output volume: generation is refused when free space is below the configured `minFreeSpaceMb` floor plus `estimatedBytesPerSecond` × duration, with a re-check before each file write and an explicit disk-full reason on `ENOSPC`. The MiniMax API key is resolved per request through `ctx.credentials` from a configured `apiKeyRef`, so the secret lives in the managed credentials store, never in the composition file.

A human entry point accompanies the tools: the `tool-video` package also registers a `/video <description>` slash command that queues one user turn carrying the description and the plan → render → assemble → present sequence, so the model drives the same pipeline without a full typed request. The command is mounted wherever the tools are (the expert preset), and it injects `createUserMessage` with `source.kind: 'user'` through `agent.followup`, which wakes an idle driver.

The workflow is confirm-first: `video_plan` may carry per-segment `references` (images as first/last frame or reference images, videos as `reference_video`, audio as `reference_audio`, each an absolute path or http(s) URL, role-validated), and the expert persona plus the `/video` message instruct the model to present the storyboard — scenes, prompts, durations, routing, and material questions — to the user and obtain approval before `video_render`. The remote API bills per second, so a local failure must be reported to the user and remote use must be approved explicitly rather than silently fallen back to through `auto` routing.

Plans render in one of two modes. `multi_shot` (the default) folds every segment into ONE H3 task whose prompt carries the shot timeline with timecodes (`[0s-6s] Shot 1: …`), bounded to ≤15s total with one uniform resolution/ratio, so shots share style, subject, and lighting instead of diverging across independent generations; the render job writes `segments/<planId>-all.mp4` and assembly returns it as-is. `per_segment` renders each shot as its own task and concats them, for shots that need their own reference material or backend. The old behavior of always rendering per-segment produced visibly inconsistent multi-shot clips, which motivated the mode split.

The flow is visuals-first, not text-to-video-first: `video_plan` declares the reusable asset anchors (characters/scenes/props) the storyboard references; `video_assets` records the user-provided reference images after the model asks the user for materials (mirroring the reference drama-production pipeline where characters get turnaround reference sheets, scenes get reusable establishing shots, and props get reference images); `video_asset_images` generates those reference images through the hosted `image-01` model when the user has none, wrapping each asset's `description` in the production spec for its kind (character turnaround sheet, people-free establishing shot, neutral prop image) into `outputDir/assets/<planId>-<assetId>.png`; `video_keyframes` generates one still keyframe per shot and saves it to `outputDir/keyframes/<planId>-<segmentId>.png`. The expert persona instructs the model to present the materials, keyframes, and storyboard to the user for approval before `video_render`. Rendering anchors a shot on the plan's asset reference images (reference conditioning) and, when a keyframe exists, on that keyframe as its first frame — image-to-video and reference conditioning are served by the remote API (local paths are sent as base64 data URIs) AND by the local ComfyUI template: the provider copies images into `comfy.inputDir`, wires a `LoadImage` node into the H3 node's frame input for keyframes, and swaps the H3 node to `MiniMaxH3ReferenceToVideo` with its `ref_images` autogrow input populated for reference images — so confirmed visuals drive the video locally instead of through the hosted API. Frame-image requests force `ratio: adaptive` per the H3 content rule, and the comfyui capabilities now advertise multimodal support.

## Testing

Provider tests run against mock HTTP servers covering submission, polling, download, failure reasons, timeouts, cancellation, and capabilities. Tool tests drive the real tool registry with stubbed `jobs` and `h3Video` services and a real `Session`; a loader-composition test boots a cordis.yml through the real Loader with a mock ComfyUI HTTP server. A manual E2E smoke (`packages/experimental/h3-video/scripts/e2e-smoke.mts`) drove the real ComfyUI server with a text2img checkpoint through submit → poll → download → ffmpeg concat and produced a valid 4s h264 file.

## Alternatives considered

- **A `video/plan` session-log event with an `ignorable` marker.** Rejected: `Session.append` exposes no `ignorable` option for non-surface events, and adding a known event type would regenerate the persistence catalog and touch session-format versioning — disproportionate for an experimental feature. File-backed plans keep the model-visible contract (the plan is in the tool result) without the format machinery.
- **A single monolith package.** Rejected: the capability-seam rule requires Service Definition / Provider / Consumer roles; `h3-video` (seam + providers) and `tool-video` (consumer) keep each package's tests and dependencies scoped.
- **`video_plan` calling the LLM internally to write shots.** Rejected: that would add a second model-visible LLM request with its own session-logging burden. The agent already writes the storyboard in its turn; the tool only validates and persists it.
- **Remote-first with local as an afterthought.** Rejected: the user's deployment is local-first on an RTX 3060, so `auto` prefers local and falls back to remote on capability or availability.

## Consequences

- Every segment render is a background job: the tool returns immediately with job ids and the standard job pipeline delivers completion notices, so a long local generation never blocks the model turn.
- Routing failures are surfaced per submission at render time with model-safe reasons, letting the agent re-route a plan and retry without guessing.
- Plans are not first-class session projections; replay shows them in `tool/result` only. A projection is deferred to the session-format work.
- The local provider is text-prompt only; image/video/audio reference inputs route to the hosted API.
- The feature is experimental: both packages are public with no stability promise, and their schemas may change while they incubate.
