---
description: "Backend-neutral MiniMax H3 video-generation seam: local ComfyUI or hosted MiniMax API providers, explicit local/remote/auto routing, and ffmpeg assembly."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-h3-video

English | [中文](README.zh.md)

## Summary

This package provides the `ctx.h3Video` service: one backend-neutral seam that generates video segments with MiniMax H3, either from a local ComfyUI deployment or the hosted MiniMax V2 API, routes each segment explicitly between the two, and assembles finished segments with ffmpeg. The model-facing `video_plan` / `video_render` / `video_assemble` tools live in the companion [`@deepseek-ai/dsh-experimental-tool-video`](../tool-video/README.md) package. Choose it when a composition should turn a conversation into a storyboard and render it locally first, failing over to the hosted API on demand. The package is published under its experimental name and provides no stability guarantee.

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

Load this package as a service plugin, then load `@deepseek-ai/dsh-experimental-tool-video` on top to expose the tools. Configure at least one backend; misconfiguration fails loud at load. A backend row is enabled by its anchor field: set `comfy.workflowPath` to enable the local ComfyUI backend, and `minimax.apiKey` to enable the hosted backend. A row without its anchor is treated as disabled.

### When to choose it

Choose it when you run MiniMax H3 video generation locally through ComfyUI and want the option of the hosted API as a fallback or for segments your GPU cannot serve (longer clips, 2K). Avoid it when no H3 workflow is reachable and no hosted API key is available — the service refuses to start with zero backends.

### Smallest working example

A local-only composition for a ComfyUI deployment on `http://127.0.0.1:8188`:

```yaml
- id: h3-video
  name: '@deepseek-ai/dsh-experimental-h3-video'
  config:
    comfy:
      url: 'http://127.0.0.1:8188'
      workflowPath: 'D:/ComfyUI/h3-workflow.json'
      resolutions: ['768P']
      minDurationSeconds: 4
      maxDurationSeconds: 10

- id: tool-video
  name: '@deepseek-ai/dsh-experimental-tool-video'
```

Adding the hosted backend is one more row referencing a credential; the key never enters the repository or composition file:

```yaml
    minimax:
      apiKeyRef: 'MINIMAX_API_KEY'
      baseUrl: 'https://api.minimax.cn'
      model: 'MiniMax-H3'
```

`apiKeyRef` names a credential resolved through `ctx.credentials` on every request. Store the key once in the managed store (or as the `MINIMAX_API_KEY` environment variable); the key is never written into `cordis.yml`. A literal `apiKey` is also accepted for test setups, but it lands in the composition file.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-h3-video) is the exhaustive source for every accepted field and its JSDoc.

### User settings overlay

The `./settings` entry (`@deepseek-ai/dsh-experimental-h3-video/settings`) is a HOST-plane row that registers the `h3-video` settings namespace and publishes its live view as the `h3VideoSettings` service. The Plugins settings page edits the namespace; its fields are the user-tunable slice of the composition config (flat names like `comfyUrl`, `comfyWorkflowPath`, `minimaxApiKeyRef`, `outputDir`, `minFreeSpaceMb`). A mounted service layers the committed section over its composition values — a present, non-empty setting wins, an absent one inherits — and rebuilds its backends when the section changes, without editing the preset's composition file. Two enable switches travel with the overlay: `comfyWorkflowPath` enables the local backend and `minimaxApiKeyRef` the hosted one, so a composition with neither anchor can be enabled entirely from settings. The MiniMax key itself is written through the credentials domain; the section names only the reference.

### What the service does

- **Submit** a validated segment request to one backend and get an opaque task reference.
- **Poll** the reference to a terminal state; a success carries the downloaded local file (remote URLs expire, so every hosted result is fetched into `outputDir`).
- **Cancel** a live task best-effort (ComfyUI `POST /interrupt`, or abort of the polling fetch).
- **Assemble** ordered segment files into one mp4 with ffmpeg, re-encoding to a uniform h264/yuv420p/24fps stream so mixed backends and resolutions still concatenate cleanly.

Routing is explicit per segment — `local`, `remote`, or `auto` (local first, fall back to remote on capability or availability). No call path receives an implicit default.

### Storage layout

All downloaded segments, plans, and final assemblies live under one configurable `outputDir`, omitted by default so downloads sit with the harness's other user data:

```
$DSH_HOME/cache/video/            # default outputDir (respects $DSH_HOME; else ~/.dsh/cache/video)
  plans/<planId>.json             # storyboard documents (tool-video)
  segments/<planId>-<segmentId>.mp4  # rendered segment files (deterministic, assembly input)
  final/<planId>.mp4              # assembled deliverable (video_assemble default)
```

Provider downloads land directly in `outputDir` and are renamed into `segments/` by the render job; nothing is copied twice. `~` in a configured `outputDir` expands to the OS home via the shared home-path resolver. The default is the DSH **cache** because every file here is a rebuildable intermediate; the final mp4 is meant to be delivered to the user (typically via `present` after `video_assemble`, or by passing an explicit `output_file` when the video should live in a workspace or elsewhere).

### Disk-space guard

Every submission preflights the output volume: the provider refuses to start a generation when the volume's free space is below `minFreeSpaceMb` **plus** `estimatedBytesPerSecond` × segment duration, and re-checks before writing a downloaded file (a volume that filled up mid-task fails the segment with an explicit disk-full reason, never a raw `ENOSPC`). Both values are deployment config, not constants: tune `estimatedBytesPerSecond` to the model's real bitrate (H3 768P ≈ 0.5 MB/s; 2K is higher) and `minFreeSpaceMb` to the headroom you want to keep. `ctx.h3Video.diskFreeMegabytes()` reports the current free space so the model can pick a backend by what the local volume can hold.

### What success and failure look like

A submitted segment either settles `succeeded` with a local file, or `failed` with a model-safe reason (ComfyUI execution error, hosted task error, or the per-task timeout). Routing rejects a segment no configured backend can serve, naming the backend and the capability mismatch. Cancellation is best-effort and never reported as success.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, not a wrapper.** `H3Video` is the Service Definition; `createComfyUIProvider` and `createMiniMaxApiProvider` are the providers; `tool-video` is the consumer. Each backend owns its transport and file download, and neither owns retry policy or routing.
- **Explicit resolution.** `resolve` is the single place that picks a backend, and it always runs request validation against the chosen backend's declared capabilities before submission.
- **Config is deployment.** Every tunable (endpoints, field names, poll intervals, timeouts, concurrency, resolution/duration limits) is a validated `Config` field; nothing is a hardcoded constant.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | `SegmentRequest`, `TaskStatus`, `H3VideoProvider`, `ProviderCapabilities`, the `H3TaskRef` brand |
| [`src/validation.ts`](src/validation.ts) | Request rules shared by both providers (text count, prompt bounds, duration/resolution range, image-vs-reference exclusivity, ratio rules) |
| [`src/routing.ts`](src/routing.ts) | `resolve` — explicit `local`/`remote`/`auto` choice against configured backends |
| [`src/comfyui.ts`](src/comfyui.ts) | Local provider: template filling, `/prompt` queue, `/history` polling, `/view` download, `/interrupt` cancel |
| [`src/minimax-api.ts`](src/minimax-api.ts) | Hosted provider: V2 creation, task polling, time-limited URL download |
| [`src/assembly.ts`](src/assembly.ts) | ffmpeg concat assembly to one uniform mp4 |
| [`src/index.ts`](src/index.ts) | The `H3Video` Service class and its default-export plugin wiring |

No runtime invariant companion is published: the seam owns no relation that independent observations could diverge on.

### ComfyUI workflow template

The local provider fills `"{{field}}"` placeholders in a JSON workflow template with each request's prompt, resolution, duration, ratio, seed, and a `length` field (frames) computed from the duration. The template is ComfyUI API-format JSON with `class_type` and `inputs`; unused placeholders are a no-op, so one template can serve text-only requests while the video nodes stay parameterized. A ready H3 template is shipped at `D:\ComfyUI\ComfyUI\models\h3-t2v-api-template.json` (built from the official Comfy-Org t2v workflow with the native `MiniMaxH3ImageToVideo` node, the turbo LoRA, and the `{{prompt}}` / `{{seed}}` / `{{length}}` placeholders) — configure `workflowPath` to it. `lengthField` defaults to `length`; the frame count is snapped to the model's `17k + 5` grid at 24 fps (`snapH3Frames`).

### Hosted API surface

The hosted provider mirrors the MiniMax V2 video API: `POST /v2/video_generation` creates a task, `GET /v2/query/video_generation/{task_id}` is polled, and the succeeded task's time-limited media URL is downloaded into `outputDir`. `MiniMax-H3` serves 4–15s at 768P/2K; `MiniMax-H3-Max` serves 5–15s at 480P/768P.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [tool-video package](../tool-video/README.md) — the model-facing tools over this service.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-h3-video) — every accepted config field and its JSDoc.

-----

<a id="model-experience"></a>
## Model Experience

### Model-facing contract

#### What the model sees

The `tool-video` tools expose plans, submission records, and assembly results as compact JSON. Each failure is a model-safe reason naming the segment or backend, never a raw stack or HTTP dump. Cancellation and timeout states are explicit, so the model can retry or route a segment differently without guessing.

#### Token effect

Provider code runs entirely outside the model loop; the model only sees the compact canonical JSON that `tool-video` returns. Polling and downloads never stream into history.

#### KV Cache effect

The service adds no system-prompt text and no per-request prefix, so it does not perturb the reusable request prefix for the LLM provider. Tool calls and results append after it as usual.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Plans are file-backed, not session events.** A `video/plan` session-log event would pull in the persistence catalog and session-format version machinery, so plans are JSON artifacts under `outputDir`. Replay of a session shows the plan in `tool/result` but not as a first-class projection.
- **ComfyUI multimodal inputs are not served.** The local provider is text-prompt only (`multimodalInputs: false`); image/video/audio references route to the hosted API.
- **Concurrency is advisory at the seam.** `maxConcurrency` is reported in capabilities for consumers to respect; the seam itself does not queue beyond what each backend does.
- **Experimental prototype with no stability promise** — the package is public, but its schemas can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The ComfyUI output picker prefers videos, then GIFs, then `type: output` images, so image-producing workflows (a text2img smoke, or an image-sequence node) still settle `succeeded` with the downloaded file. The [`scripts/e2e-smoke.mts`](scripts/e2e-smoke.mts) manual smoke drives a real local server with a text2img checkpoint and an ffmpeg concat; it is not part of the test suite.

</details>
