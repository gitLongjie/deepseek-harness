---
description: "Model-facing MiniMax H3 video tools: storyboard planning, background segment rendering, and ffmpeg assembly over the ctx.h3Video service."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-video

English | [中文](README.zh.md)

## Summary

This package registers three model-facing tools — `video_plan`, `video_render`, and `video_assemble` — that turn a conversation into a storyboard, render the shots with MiniMax H3 in the background, and concat the finished segments into one mp4. It is the consumer of the [`@deepseek-ai/dsh-experimental-h3-video`](../h3-video/README.md) service seam. Choose it when the model should drive "describe → storyboard → render → assemble" from a single conversation, with local ComfyUI and hosted API backends. The package is published under its experimental name and provides no stability guarantee.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load this package on top of `@deepseek-ai/dsh-experimental-h3-video`, plus the background-job runtime (`@deepseek-ai/dsh-jobs-local` and `@deepseek-ai/dsh-tool-jobs` are part of the base composition). The three tools become available to every agent.

### When to choose it

Choose it when the model should plan and render video from a conversation without leaving the session. Avoid it when video generation must run headlessly outside an agent, or when no H3 backend is configured (the service refuses to start, and the tools fail loud at load).

### Smallest working example

```yaml
- id: h3-video
  name: '@deepseek-ai/dsh-experimental-h3-video'
  config:
    comfy:
      url: 'http://127.0.0.1:8188'
      workflowPath: 'D:/ComfyUI/h3-workflow.json'

- id: tool-video
  name: '@deepseek-ai/dsh-experimental-tool-video'
```

This plugin declares no configuration of its own; the generated [configuration catalog](../../../docs/config-catalog.md#loadable-plugins-with-no-config) lists it among the config-less loadable plugins.

### What the model can do

- **`video_plan(goal, segments, mode?, assets?, style?)`** — structure the conversation request into a versioned storyboard and persist it as a JSON artifact. Passing an existing `plan_id` revises it and bumps the revision. Segments carry an id, the shot prompt, optional camera guidance, duration, resolution, ratio, a per-segment `local`/`remote`/`auto` routing choice, and optional `references` (reference materials: images as `first_frame`/`last_frame`/`reference_image`, videos as `reference_video`, audio as `reference_audio`, each an absolute path or http(s) URL). Reference roles are validated against their type. `assets` declares the reusable character/scene/prop anchors the storyboard references; `style` is a one-line visual directive. `mode` defaults to `multi_shot`, which folds the whole storyboard into ONE H3 task (≤15s total, one resolution/ratio) so shots stay coherent; `per_segment` renders each shot independently and concats them, for shots that need their own material or backend.
- **`video_assets(plan_id, assets, style?)`** — record the reusable asset anchors and their user-provided reference images after asking the user for materials. Each asset reference must be an absolute local path or http(s) URL. These anchors condition rendering so characters/scenes/props stay consistent across shots.
- **`video_asset_images(plan_id, asset_ids?)`** — generate the reference image for assets that have none, using the production spec per kind: characters get a turnaround reference sheet (front close-up plus front/side/back full views), scenes get a reusable establishing shot without people, props get a neutral reference image. Each lands in `outputDir/assets/<planId>-<assetId>.png` and is recorded on the plan. Each result carries its image beside the path, so a generated material is visible in the conversation rather than only named.
- **`video_keyframes(plan_id, segment_ids?)`** — generate one still keyframe per selected segment (hosted image model), establishing the scene and visual identity BEFORE video generation. Keyframes land in `outputDir/keyframes/<planId>-<segmentId>.png` and are meant to be shown to the user for confirmation; each result carries its image, so the confirmation step shows the pictures rather than paths. A shot without a keyframe renders as text-to-video.
- **`video_render(plan_id, segment_ids?, backend?)`** — submit to the routed backend and start a background job that polls generation to completion. In `multi_shot` mode one job renders the whole storyboard (`all` segment id); in `per_segment` mode each selected segment gets its own job. Anchoring follows the H3 conditioning rules: frame conditioning (`first_frame`/`last_frame`) and reference conditioning are mutually exclusive, so a shot with any reference material — plan asset anchors or authored reference inputs — unifies on full-reference (the keyframe or authored frame input degrades to a `reference_image`, keeping every anchor instead of dropping some), and the prompt gains a `References: <Picture N> …` contract line labeling each attached item in content order; image conditioning is served locally through the ComfyUI `MiniMaxH3ReferenceToVideo` node. A shot with only a keyframe renders as image-to-video (`first_frame`); a shot with neither stays text-to-video. Returns submission records with job ids; results arrive through the normal job notices and `job_output`. Video/audio references still need the hosted API (the local workflow serves image conditioning only).
- **`video_assemble(plan_id, output_file?, ffmpeg_path?)`** — produce the final video: for `multi_shot` the single rendered clip is returned as-is (no concat); for `per_segment` the plan's rendered segments are concatenated in storyboard order with ffmpeg. The default output is `<outputDir>/final/<planId>.mp4` for per-segment; pass `output_file` to place the deliverable elsewhere, such as a workspace, and call `present` on it so the user receives the finished video. Fails listing any segment that has not been rendered yet.

The intended flow is **materials-first**: draft the storyboard and the asset inventory with `video_plan`, **ask the user to provide character/scene/prop reference images** and record them with `video_assets` (or generate them with `video_asset_images` when the user has none), generate keyframes with `video_keyframes`, present everything to the user for approval, and only render after confirmation — the remote backend (which bills per second) is never used without the user's explicit consent. A human can invoke the whole pipeline directly with the **`/video <描述>`** slash command: it queues one user turn carrying the description plus the materials-then-confirm-then-render sequence. H3 generates audio in the same pass as the picture, so shot prompts should declare their sound layers: the ambience/SFX baseline, Chinese dialogue verbatim inside `<d>[Chinese] 台词</d>`, and `non_diegetic_music: N/A` when no music is wanted (leaving the layer unstated tends to add background music); the `/video` turn tells the model this.

### What success and failure look like

A render submission either carries a job id (`state: submitted`) or a model-safe error (`state: failed`, no job started). A job settles `[succeeded] s1 -> <file>` or `[failed] s1: <reason>` in its output. Assembly fails with the exact missing segment ids when the render jobs have not finished. Routing failures (e.g. a segment too long for the local backend) are surfaced per submission at render time, so the model can re-route the plan and retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **The service owns generation; the tools own the workflow.** All backend logic lives in `h3-video`; this package only structures plans, starts jobs, and assembles.
- **Long work is background work.** Every segment render runs as a `h3-video`-kind job (`JobKindMap` is extended by declaration merging), so the tool returns immediately with job ids instead of blocking the model turn.
- **Canonical JSON everywhere.** Every tool declares its complete result schema and renders it as compact JSON, so the compiler checks `execute` against what the model is promised.
- **Deterministic segment paths.** A successful render moves the provider output to `outputDir/segments/<planId>-<segmentId>.mp4`, which is exactly what `video_assemble` reads, in plan order.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry and the three tool registrations |
| [`src/types.ts`](src/types.ts) | `VideoSegment`, `VideoPlan`, `RenderSubmission`, and the `h3-video` job-kind extension |

No runtime invariant companion is published: plan files and job records are owned by the fs layer and the job registry, not by this package.

### Plan storage

Plans are JSON artifacts under `<outputDir>/plans/<planId>.json` written atomically (temp file + rename). The plan content also appears verbatim in the `video_plan` result, so session replay reconstructs what the model saw even though the plan is not a session event. Plan ids are per-session monotonic (`vp-1`, `vp-2`, …).

### Job lifecycle

`video_render` submits each segment synchronously (fast — it only enqueues the task), then registers a `h3-video` job whose producer polls the provider to a terminal state. Cancellation aborts the polling signal and best-effort cancels the backend task. A submission that fails before a job starts is reported inline with no job id; nothing is orphaned silently.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [h3-video package](../h3-video/README.md) — the `ctx.h3Video` service seam behind these tools.
- [Generated tool catalog](../../../docs/tool-catalog.md) — every tool schema the model receives.
- [Generic long-running tool runtime Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md) — the background-job producer contract.

-----

<a id="model-experience"></a>
## Model Experience

### Model-facing contract

#### What the model sees

Three tools with compact JSON results. The render tool returns submission records with job ids and a one-line notice; the jobs deliver their own completion notices through the standard job pipeline. Failures are model-safe reasons naming the segment or backend, never raw stack traces. The tools carry no per-call hidden state: plans are re-read from disk by id, so a plan created in one turn is usable in the next.

#### Token effect

Each tool call adds its compact JSON result to history; render and poll output never streams into the model context. The render job output is bounded by `outputLimitBytes` (4 KB per job).

#### KV Cache effect

The package adds no system-prompt text, so it does not perturb the reusable request prefix for the LLM provider. Tool calls and results append after it as usual.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No session-log plan projection.** Plans are file-backed (see [Understand the implementation](#understand-the-implementation)); a first-class projection is deferred to the session-format work.
- **Assembly is re-encode, not stream-copy.** `video_assemble` re-encodes with libx264 for uniformity; very long films take minutes on CPU-only hosts.
- **Experimental prototype with no stability promise** — the package is public, but its schemas can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tool tests drive the real tool registry with stubbed `jobs` and `h3Video` services and a real `Session`; `video_render`'s job producer is exercised through the stub's `start` capture. The `h3-video` kind is declared in `src/types.ts` so the `JobKind` union stays merge-extensible.

</details>
