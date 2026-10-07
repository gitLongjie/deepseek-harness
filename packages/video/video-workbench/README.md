---
description: "Read-only video workbench: the projects and file routes projecting the h3-video output directory to the browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-video-workbench

English | [中文](README.zh.md)

## Summary

The host half of the video workbench: two read-only web-server routes projecting the h3-video output directory — where the `tool-video` pipeline lands plans, keyframes, segments, and final assemblies. `GET /api/video-workbench/projects` lists plan artifacts with their on-disk rendering state; `GET /api/video-workbench/file?path=<relative>` serves one whitelisted file confined to that directory. The browser half — the sidebar panel row and the project catalog page — lives in [`@deepseek-ai/dsh-client-ui-video-workbench`](../../client/ui-video-workbench/README.md). Choose it when video renders should be browsable in the Web GUI without granting the browser a write path.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Load the package as a host plugin (the web-app bundle carries it). Configuration is one optional field:

```yaml
- id: video-workbench
  name: '@deepseek-ai/dsh-video-workbench'
```

`outputDir` defaults to the DSH cache `video` directory (`$DSH_HOME/cache/video`) — the same default the `h3-video` service uses — so a stock deployment needs no configuration. Point it elsewhere with `outputDir` (`~` expands to the OS home) when the video service was configured to a custom directory.

The routes answer `GET`/`HEAD` only. File serving admits whitelisted extensions (`.json`/`.md`/`.txt`, images, video, audio) up to 256 MB per file; the requested path is split into plain name segments (no `..`, no drive letters), joined under the projected root, and re-checked after symlink resolution, so nothing outside the directory is ever answered. A corrupt plan becomes one error row in the listing instead of failing it.

## Understand the implementation

- [`src/projects.ts`](src/projects.ts) scans `plans/*.json` and reports, per project, the revision, goal, mode, per-shot rendering state, keyframe paths, and the final assembly; multi-shot plans collapse onto their synthetic `all` segment.
- [`src/file-serve.ts`](src/file-serve.ts) owns the containment resolver, the extension whitelist, and the streamed response.
- [`src/index.ts`](src/index.ts) registers both routes through `ctx.webServer.register` under `ctx.effect`, so the rows live exactly as long as the plugin.

**Runtime invariant:** No companion is published. Both routes read the output directory per request and hold no cross-request state, so there is no owned relationship for a companion to observe.

## Model Experience

### Model-facing contract

#### What the model sees

Nothing. The workbench registers no tools and emits no session events; the model loop is unaware of it. The browser page is the only consumer of `GET /api/video-workbench/projects` and `GET /api/video-workbench/file`.

#### Token effect

No effect: routes are read-only HTTP answers to the browser and never enter a model request or the session transcript; the `plans/*.json` scan stays inside the host process.

#### KV Cache effect

No effect: the package adds no system-prompt text and no per-request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No byte-range responses.** The file route answers whole files; a browser buffers the body before seeking. Range support can follow once the write-gate rule that false-positives range-header parsing is corrected.
- **No pagination or polling feed.** The listing scans every `plans/*.json` on each request; a `?since=` query on the route is the natural extension for large catalogs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Routes register through `ctx.webServer.register` under `ctx.effect`, so the rows live exactly as long as the plugin. The file service's containment order is segment whitelist → extension whitelist → `realpath` on both ends → `relative` re-check; read the matching refusal cases in `tests/workbench.spec.ts` before changing any step. Bilingual ToC anchors keep English slugs so both sides' links agree.

</details>
