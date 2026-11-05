---
description: "Video workbench: the project, file, and deletion routes projecting the h3-video output directory to the browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-video-workbench

English | [中文](README.zh.md)

## Summary

Browse video plans, cast and set assets, keyframes, clips, and final assemblies in the Web GUI. The workbench reads the `tool-video` output directory, preserves authored shot information, and moves deleted project or asset files into a recoverable trash directory. Its default output directory matches `h3-video`. The [browser plugin](../../client/ui-video-workbench/README.md) supplies the sidebar entry and project page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Load the package as a host plugin (the web-app bundle carries it). Configuration accepts an output directory and authoring size limit:

```yaml
- id: video-workbench
  name: '@deepseek-ai/dsh-video-workbench'
```

`outputDir` defaults to the DSH cache `video` directory (`$DSH_HOME/cache/video`) — the same default the `h3-video` service uses — so a stock deployment needs no configuration. Point it elsewhere with `outputDir` (`~` expands to the OS home) when the video service was configured to a custom directory.

The read routes answer `GET`/`HEAD`; the two deletion routes answer `POST` with a JSON body (`{id}` or `{planId, assetId}`) and validate the id shape before touching a path. Deletion moves files into `<cache>/video-trash/<timestamp>-<id>-<unique>/` at their original relative position, so a mis-click is recoverable by hand; nothing is unlinked. They register on Connection's exact Fetch registry — the dispatch surface the browser's `/api` route and the desktop shell's in-process transport share — so requests pass Connection's Host/Origin fence and browser authentication before reaching them. File serving admits whitelisted extensions (`.json`/`.md`/`.txt`, images, video, audio) up to 256 MB per file; the requested path is split into plain name segments (no `..`, no drive letters), joined under the projected root, and re-checked after symlink resolution, so nothing outside the directory is ever answered. A corrupt plan becomes one error row in the listing instead of failing it. Multi-shot tasks retain every authored shot, including its id, prompt, duration, camera direction, resolution, ratio, backend, asset ids, continuity relation, and start/event/end states; an omitted mode uses the pipeline default, `multi_shot`. Its combined `segments/<planId>-all.mp4` is the completed video, matching `video_assemble`; per-segment plans use `final/<planId>.mp4`.

The listing also projects each plan's recorded cast/set/prop assets: the reference image, the canonical prompt block, and whether the project asset library (`assets/library.json`) carries the asset by name. Legacy character master sheets are still projected when an older plan records one. An asset image is reported only when the file route could serve it — inside the projected directory with a served extension — so a user-supplied photo elsewhere on disk is listed as text, never as a dead image URL. A missing or corrupt library reads as empty: the projection reports rendering state, and a broken library must not hide the projects.

## Understand the implementation

- [`src/projects.ts`](src/projects.ts) scans `plans/*.json` and reports, per project, the revision, goal, mode, per-shot rendering state, keyframe paths, the final assembly, and the recorded assets with their servable images and library state; multi-shot plans group their authored `shots` under the synthetic `all` render task. The browser imports these listing types without adding host code to its artifact.
- [`src/file-serve.ts`](src/file-serve.ts) owns the containment resolver, the extension whitelist, and the streamed response.
- [`src/trash.ts`](src/trash.ts) owns the two deletions: project artifacts discovered by id prefix, and one plan asset plus the images it recorded, with unshared files moved into `video-trash` and the plan rewritten without the asset. Files referenced by another plan’s assets or authored segment references, by remaining assets or segments in the same plan, or by the project library remain in place. Asset deletion also saves the original plan in the recovery directory; a failed write restores moved files. An unreadable referring document blocks deletion because its references cannot be checked.
- [`src/index.ts`](src/index.ts) registers all four routes on Connection's exact Fetch registry under `ctx.effect`, so the rows live exactly as long as the plugin.

**Runtime invariant:** No companion is published. The store validates collection ids, relationship endpoints, revisions and clip timing; one instance refuses concurrent exports of the same work.

## Model Experience

### Model-facing contract

#### What the model sees

The host provides `ctx.videoWorkbenchStudio`; the agent-scoped `@deepseek-ai/dsh-video-workbench/tools` entry registers `video_studio_read`, `video_studio_save` and `video_studio_export`. Reads return complete JSON, saves return the committed id/revision, and exports return the media path, duration and source revision. Tool arguments and results follow normal Session logging; GUI changes remain work artifacts.

#### Token effect

Reading a work exposes its authored text and collections in the tool result. Catalog reads return summaries; saves and exports return compact metadata. HTTP-only editing adds no model messages.

#### KV Cache effect

The tools entry contributes stable tool definitions; the host entry adds no prompt text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single-range responses only.** The file route answers one `bytes=` range (206, with `Content-Range` and `Accept-Ranges`) and refuses a past-end range (416); a multi-range request falls back to the whole file. The desktop app-scheme carrier buffers the response before handing it to the media element, so playback there starts after the download completes.
- **No coordination with active generation.** Delete projects only after their render jobs have settled; a running producer can recreate files after deletion.
- **No pagination or polling feed.** The listing scans every `plans/*.json` on each request; a `?since=` query on the route is the natural extension for large catalogs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Routes register on Connection's exact Fetch registry under `ctx.effect`, so the rows live exactly as long as the plugin; a route registered only on the web server answers the browser and never the desktop shell, which dispatches `/api` through that registry. The file service's containment order is segment whitelist → extension whitelist → `realpath` on both ends → `relative` re-check; read the matching refusal cases in `tests/workbench.spec.ts` before changing any step, and `tests/transport.spec.ts` for the carrier dispatch. Bilingual ToC anchors keep English slugs so both sides' links agree.

</details>

Authoring uses `GET /api/video-workbench/studio` (catalog or `?id=` document) and `POST` (`{content}` to create; `{id,revision,content}` to save). Content contains `title`, `source`, ordered `blocks`, canvas cards, graph nodes and edges, director scenes, and edit tracks. Immutable revisions live under `studio/<id>/<revision>.json`. Stale saves return 409; corrupt or unsupported data returns 422 and is preserved. `maxStudioBytes` defaults to 2 MiB. Atomic publication requires filesystem hard links; storage failures preserve existing revisions. The host provides the same `ctx.videoWorkbenchStudio` owner for model-facing tools; generated plans remain separate artifacts.

Timeline export uses `POST /api/video-workbench/studio/export` with `{id,revision}`. It renders the captured revision into an isolated directory, mixes audio, layers later video tracks over earlier ones and embeds selectable MP4 subtitles from subtitle clip names. Source paths are resolved through the controlled media resolver; source in points and clip lengths must fit the probed media duration. Failed exports remove only their temporary output; existing revisions remain intact. Cancellation terminates subprocesses. The `studioRender` configuration sets `ffmpegPath`, `ffprobePath`, `timeoutMs` (300000), `maxDurationSeconds` (600), `maxClips` (64), `width` (1280), `height` (720) and `fps` (30); dimensions must be even integers. The defaults use FFmpeg and FFprobe on PATH.
