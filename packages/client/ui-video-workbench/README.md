---
description: "Video workbench page: the sidebar panel row and the project catalog over the h3-video output directory."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-video-workbench

English | [中文](README.zh.md)

## Summary

This package is the browser half of the video workbench: one global panel row in the sidebar (id `video-workbench`, beside the scheduled-work row) and the matching `main` page. The page lists the video projects the host routes report — goal, mode, revision, per-shot rendering state — and shows the selected project's cast and sets (each asset's reference image, canonical prompt block, and project-library state), keyframe thumbnails, and its final assembly in a `<video>` element. Legacy character master sheets are shown only when an older project records one. Data arrives from [`@deepseek-ai/dsh-video-workbench`](../../video/video-workbench/README.md)'s routes; this package owns page-local work drafts and editing history.

## Table of Contents

- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Understand the implementation

- [`src/client/index.ts`](src/client/index.ts) registers the `sidebar.panellist` row and the keyed `main` entry once their slot declarations are on the ledger, and binds the page's injected loader to the same-origin projects route.
- [`src/client/VideoWorkbenchPage.tsx`](src/client/VideoWorkbenchPage.tsx) renders the catalog and detail panes; the listing refreshes on open, every 10 seconds, and on the refresh button. The detail pane shows the cast/set assets first (reference and master-sheet thumbnails, the prompt block, and the library badge), then the authored storyboard and the final assembly. Each render task retains its original shot prompts, durations, camera directions, resolution, and ratio, including the shots grouped under `all`. Only the latest refresh may update the listing; an absent clip is shown as not rendered. Unreadable-plan counts remain visible even when no valid project can be listed. Clicking a thumbnail opens a larger preview; Escape, the close button, or a backdrop click closes it. Media URLs go through the host file route with the projected root stripped.
- All copy is locale-owned through the `videoWorkbench` dictionary namespace ([`src/client/locales.ts`](src/client/locales.ts)).

**Runtime invariant:** No companion is published. The common editor owns the selected work, draft and undo history; tabs do not save separate copies. Save before leaving the page.

The workbench keeps one shared draft and revision across screenplay, canvas, graph, director, timeline and skills tabs. Canvas cards have editable text and positions, zoom and pointer repositioning. Relationships have editable nodes and directed edges. The Three.js director uses proxy boxes and an origin-facing camera with saved position and field of view. Timeline tracks support video, dialogue, effects, music and subtitles, with source paths, in points, start times, durations and volume. Save first to export locally through FFmpeg, then preview or download the resulting MP4. Skill buttons prepare a conversation draft for the saved work; they never send a message.

## Model Experience

### Model-facing contract

#### What the model sees

The page registers no tools. Skill and regeneration actions prepare chat drafts; these enter model conversations only after the user sends them. Work persistence uses host routes, and the host package supplies the model-facing tools entry.

#### Token effect

No effect: the page never enters a model request or the session transcript.

#### KV Cache effect

No effect: the package adds no system-prompt text and no per-request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Production editing is a first native implementation.** There is no model import, camera animation, transition editor, burned-in subtitles or live timeline playback. Save before leaving the workbench; unsaved drafts do not survive page remounts. Export requires FFmpeg/FFprobe and playable media already inside the video output directory.

- **Regeneration requires chat confirmation.** Shot and asset actions seed the current composer; a combined `all` task requests regeneration of the complete storyboard. They never submit generation directly. Project and asset deletion require a second click and use the host recovery directory.
- **The desktop carrier buffers media.** The file route answers byte ranges, so a browser seeks without re-downloading; the desktop app-scheme carrier hands the media element one buffered body, so playback there starts after the download completes.
- **Experimental prototype with no stability promise** — the package is public, but its slots and copy can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `main` slot's `inject` is a factory (`() => injected`); the slot runtime flattens its return value together with `t` into the page props — passing the object instead of the factory fails the type. Media URLs always go through `workbenchFileUrl` (root stripping plus separator normalization); do not hand-build `?path=` queries in components. Bilingual ToC anchors keep English slugs.

</details>

The screenplay editor supports source comparison, typed blocks, reordering, undo/redo, explicit revision saves and Fountain export. Failed saves retain the draft. Switching studio tabs retains it while the page remains mounted; save before leaving the workbench or refreshing the application.
