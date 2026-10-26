---
description: "Model-facing MiniMax H3 video tools: storyboard planning, background segment rendering, and ffmpeg assembly over the ctx.h3Video service."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-video

English | [中文](README.zh.md)

## Summary

This package registers the model-facing tools — `video_plan`, `video_render`, `video_assemble`, `video_gpu`, and the keyframe/asset/library tools — that turn a conversation into a storyboard, render the shots with MiniMax H3 in the background, manage the cloud GPU behind the local backend, and concat the finished segments into one mp4. It is the consumer of the [`@deepseek-ai/dsh-h3-video`](../h3-video/README.md) service seam. Choose it when the model should drive "describe → storyboard → render → assemble" from a single conversation, with local ComfyUI (optionally on a provisioned GPU instance) and hosted API backends.

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

Load this package on top of `@deepseek-ai/dsh-h3-video`, plus the background-job runtime (`@deepseek-ai/dsh-jobs-local` and `@deepseek-ai/dsh-tool-jobs` are part of the base composition). The eight tools become available to every agent.

### When to choose it

Choose it when the model should plan and render video from a conversation without leaving the session. Avoid it when video generation must run headlessly outside an agent, or when no H3 backend is configured (the service refuses to start, and the tools fail loud at load).

### Smallest working example

```yaml
- id: h3-video
  name: '@deepseek-ai/dsh-h3-video'
  config:
    comfy:
      url: 'http://127.0.0.1:8188'
      workflowPath: 'D:/ComfyUI/h3-workflow.json'

- id: tool-video
  name: '@deepseek-ai/dsh-tool-video'
```

This plugin declares no configuration of its own; the generated [configuration catalog](../../../docs/config-catalog.md#loadable-plugins-with-no-config) lists it among the config-less loadable plugins.

### What the model can do

- **`video_plan(goal, segments, mode?, assets?, library_assets?, style?, seed?, allow_remote?)`** — structure the conversation request into a versioned storyboard and persist it as a JSON artifact. Passing an existing `plan_id` revises it and bumps the revision. Segments carry an id, the shot prompt, optional camera guidance, duration, resolution, ratio, a per-segment `local`/`remote`/`auto` routing choice, and optional `references` (reference materials: images as `first_frame`/`last_frame`/`reference_image`, videos as `reference_video`, audio as `reference_audio`, each an absolute path or http(s) URL). Reference roles are validated against their type. `assets` declares the reusable character/scene/prop anchors the storyboard references, each optionally carrying a fixed `prompt` block; `library_assets` attaches saved assets by name or id from the project library instead of redefining them; `style` is a one-line visual directive injected into every generation prompt; `seed` is stored on the plan and shared by every segment and keyframe, derived from the plan identity when omitted. `mode` defaults to `multi_shot`, which folds the whole storyboard into ONE H3 task (≤15s total, one resolution/ratio) so shots stay coherent; `per_segment` renders each shot independently and concats them, for shots that need their own material or backend.
- **`video_assets(plan_id, assets, style?)`** — record the reusable asset anchors, their user-provided reference images, and an optional canonical `prompt` block after asking the user for materials. Each asset reference must be an absolute local path or http(s) URL. Recording an asset also saves it to the project asset library, so a later episode reuses the same settings instead of redefining them.
- **`video_asset_images(plan_id, asset_ids?, regenerate?, seed?)`** — generate the anchor images for assets that need them. A character gets two: a front-facing half-body portrait (`outputDir/assets/<planId>-<assetId>.png`) that becomes the subject reference every keyframe is conditioned on, and a master sheet (`-sheet.png`) showing front/side/back views plus a face close-up, generated **from the portrait** so the views cannot drift in hair, features, wardrobe, accessories, or body proportion. Scenes get a reusable establishing shot without people; props get a neutral reference image. `regenerate` replaces confirmed images, and `seed` makes a design reproducible or, left out, gives a fresh take. Each result carries its images beside the paths, and the saved record joins the project library.
- **`video_keyframes(plan_id, segment_ids?, seed?)`** — generate one still keyframe per selected segment (hosted image model), establishing the scene and visual identity BEFORE video generation. Each still carries the plan's style line and, when the shot names an anchored character, that character's portrait as the image API's `subject_reference`, so a still looks like the confirmed character rather than a fresh face. Keyframes land in `outputDir/keyframes/<planId>-<segmentId>.png` and are meant to be shown to the user for confirmation; each result carries its image, so the confirmation step shows the pictures rather than paths. A shot without a keyframe uses its authored references and asset anchors when available, otherwise text-to-video. `seed` overrides the plan seed for one batch: a re-run reproduces the accepted stills, and a rejected still gets another take from a different seed.
- **`video_render(plan_id, segment_ids?, backend?, allow_remote?, chain?)`** — submit to the routed backend and start a background job that polls generation to completion. In `multi_shot` mode one job renders the whole storyboard (`all` segment id); in `per_segment` mode each selected segment gets its own job. Anchoring follows the H3 conditioning rules: frame conditioning (`first_frame`/`last_frame`) and reference conditioning are mutually exclusive. A shot that has a keyframe and no authored material starts from that keyframe as `first_frame` — the still was drawn from the confirmed portraits, so it already carries the cast and the set, while loose reference images make the model re-invent the scene on every shot. A shot without a keyframe unifies its asset anchors and authored references on full-reference (the authored frame input degrades to a `reference_image`, keeping every anchor instead of dropping some), and the prompt gains a `References: <Picture N> …` contract line labeling each attached item in content order; image conditioning is served locally through the ComfyUI `MiniMaxH3ReferenceToVideo` node. `chain=true` renders selected shots serially in storyboard order, using the preceding clip’s final frame for the next shot except at explicit cuts. Returns submission records with job ids; results arrive through the normal job notices and `job_output`. Video/audio references still need the hosted API (the local workflow serves image conditioning only). A selection that would render on the hosted API is refused until the call carries `allow_remote=true`, because that backend bills per generated second: the refusal names the segments and their total seconds, so the spend is a decision the conversation records instead of a routing side effect. Each successful submission reports `resolved`, the backend routing actually reached — the only field that tells `auto`-local from `auto`-remote after the fact. `video_plan` takes the same flag, so a paid routing choice cannot be frozen into a plan the user never approved.
- **`video_assemble(plan_id, output_file?, ffmpeg_path?, transition?, transition_seconds?)`** — produce the final video: for `multi_shot` the single rendered clip is returned as-is (no concat); for `per_segment` the plan's rendered segments are concatenated in storyboard order with ffmpeg. `transition="crossfade"` is the default: adjacent pictures and sound overlap for `transition_seconds` (default 0.4 seconds, capped at half of either adjacent clip). The returned duration subtracts these overlaps. `transition="cut"` splices clips directly; `transition="dip"` fades each clip through black, with `transition_seconds` specifying the half-width (default 0.25 seconds). Transitions normalize clip dimensions, frame rates, and audio; silent clips receive silence. Planned durations trim or pad each clip before assembly. Processing failures are reported without substituting a hard cut. Transition assembly requires ffprobe beside ffmpeg or on PATH. Multi-shot assembly returns `segments/<planId>-all.mp4` and ignores output and transition options. The default output is `<outputDir>/final/<planId>.mp4` for per-segment; pass `output_file` to place the deliverable elsewhere, such as a workspace, and call `present` on it so the user receives the finished video. Fails listing any segment that has not been rendered yet.
- **`video_library()`** — list the project asset library: every character/scene/prop saved with its canonical prompt block, reference image, and character master sheet. `video_plan library_assets` attaches one by name.
- **`video_gpu(action)`** — manage the cloud GPU behind the local backend: `status` reports the instance, `up` boots or reuses it and waits until ComfyUI answers, `stop` powers it off keeping its disk, and `release` deletes it. GPU time is billed while the instance runs; a local render boots it implicitly, so calling `up` first only surfaces a boot failure before the render is submitted.

### Keeping separately rendered shots on one look

`per_segment` renders every shot as its own task, so visual consistency has to be carried into each one rather than inherited from a single generation. Six mechanisms apply to every render:

- **Anchors**: a shot is conditioned on the anchored assets its prompt names — the character, set, and props that appear in it — and on every anchored asset when it names none. Each attached asset's block is appended to the prompt as well, so the reference image and the text agree. A character's anchor is the portrait `video_asset_images` produces, or the photo the user supplied; the master sheet is the design record, not a conditioning input.
- **Prompt invariance**: each asset carries one canonical `prompt` block copied verbatim into its portrait, master sheet, every keyframe, and every clip; `description` is only the short human-facing summary used when no block is written. Changing the block is the only way the wording changes, which is what keeps separately rendered shots described identically.
- **Project library**: recorded assets live in `<outputDir>/assets/library.json`. A later plan attaches them with `library_assets` and inherits the block, the portrait, and the sheet, so an episode never redefines its cast from scratch.
- **Style**: the plan's `style` line is appended to every generation prompt, including keyframes and asset images.
- **Keyframes**: a still generated for a shot carries that style and, for a character the shot names, the character's portrait as a subject reference; the clip is then generated from the still, so the face and wardrobe are fixed before any motion is sampled.
- **Seed**: one seed is stored on the plan and filled into every local ComfyUI submission, so a re-render samples the same noise and two shots of one plan start from the same random draw. The hosted H3 API has no seed parameter and ignores it. The keyframe batch and each asset image accept their own seed override, which is how an accepted look is reproduced and a rejected one is re-rolled.

A plan whose shot prompts name their assets, whose cast comes from the project library, whose keyframes are confirmed before rendering, and whose style and seed stay fixed is what keeps a multi-segment film from looking like unrelated clips; the render prompt's `References:` line names exactly the images attached to each shot.

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

- **The service owns generation; the tools own the workflow.** All backend logic lives in `h3-video`, including the cloud GPU lifecycle; this package only structures plans, starts jobs, and assembles.
- **Long work is background work.** Every segment render runs as a `h3-video`-kind job (`JobKindMap` is extended by declaration merging), so the tool returns immediately with job ids instead of blocking the model turn.
- **Typed results.** Every tool declares its result schema. Results use compact JSON; image-generation tools also attach image content for review.
- **Deterministic segment paths.** A successful render moves the provider output to `outputDir/segments/<planId>-<segmentId>.mp4`, which is exactly what `video_assemble` reads, in plan order.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry and the eight tool registrations |
| [`src/types.ts`](src/types.ts) | `VideoSegment`, `VideoPlan`, `RenderSubmission`, and the `h3-video` job-kind extension |

No runtime invariant companion is published: plan files and job records are owned by the fs layer and the job registry, not by this package.

### Plan storage

Plans are JSON artifacts under `<outputDir>/plans/<planId>.json` written atomically (temp file + rename). The plan content also appears verbatim in the `video_plan` result, so session replay reconstructs what the model saw even though the plan is not a session event. Plan ids are monotonic per output directory (`vp-1`, `vp-2`, …): the series lives with the artifacts it names, so a new session continues it instead of reusing `vp-1` and overwriting the previous project's plan, keyframes, and cuts.

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

Eight tools with compact JSON results; asset-image and keyframe results also carry images. The render tool returns submission records with job ids and a one-line notice; the jobs deliver their own completion notices through the standard job pipeline. The GPU tool returns the instance state with a one-line notice naming the service URL and the idle window. Failures are model-safe reasons naming the segment or backend, never raw stack traces. The tools carry no per-call hidden state: plans are re-read from disk by id, so a plan created in one turn is usable in the next.

#### Token effect

Each tool call adds its compact JSON result and any attached images to history; render and poll output never streams into the model context. The render job output is bounded by `outputLimitBytes` (4 KB per job).

#### KV Cache effect

The package adds no system-prompt text, so it does not perturb the reusable request prefix for the LLM provider. Tool calls and results append after it as usual.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No session-log plan projection.** Plans are file-backed (see [Understand the implementation](#understand-the-implementation)); a first-class projection is deferred to the session-format work.
- **Per-segment assembly re-encodes.** `video_assemble` re-encodes with libx264 for uniformity; very long films take minutes on CPU-only hosts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tool tests drive the real tool registry with stubbed `jobs` and `h3Video` services and a real `Session`; `video_render`'s job producer is exercised through the stub's `start` capture. The `h3-video` kind is declared in `src/types.ts` so the `JobKind` union stays merge-extensible.

</details>
