---
description: "Video workbench page: the sidebar panel row and the project catalog over the h3-video output directory."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-video-workbench

English | [中文](README.zh.md)

## Summary

This package is the browser half of the video workbench: one global panel row in the sidebar (id `video-workbench`, beside the scheduled-work row) and the matching `main` page. The page lists the video projects the host routes report — goal, mode, revision, per-shot rendering state — and shows the selected project's keyframe thumbnails and its final assembly in a `<video>` element. Data arrives from [`@deepseek-ai/dsh-video-workbench`](../../video/video-workbench/README.md)'s read-only routes; this package holds no state beyond selection and refresh.

## Table of Contents

- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Understand the implementation

- [`src/client/index.ts`](src/client/index.ts) registers the `sidebar.panellist` row and the keyed `main` entry once their slot declarations are on the ledger, and binds the page's injected loader to the same-origin projects route.
- [`src/client/VideoWorkbenchPage.tsx`](src/client/VideoWorkbenchPage.tsx) renders the catalog and detail panes; the listing refreshes on open, every 10 seconds, and on the refresh button. Media URLs go through the host file route with the projected root stripped.
- All copy is locale-owned through the `videoWorkbench` dictionary namespace ([`src/client/locales.ts`](src/client/locales.ts)).

**Runtime invariant:** No companion is published. The page holds only its selection and the last fetched listing, both React-local, so no owned relationship crosses a package boundary for a companion to observe.

## Model Experience

### Model-facing contract

#### What the model sees

Nothing. The page registers no tools and writes no session state; rendering stays in the browser, and the injected loader wraps exactly one same-origin request through `loadSummary()`.

#### Token effect

No effect: the page never enters a model request or the session transcript.

#### KV Cache effect

No effect: the package adds no system-prompt text and no per-request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No in-page re-render or edit actions.** The workbench is a read projection; rendering flows through the `/video` pipeline with its confirmation gate.
- **Whole-file media buffering.** Keyframes and finals load whole; the host file route has no byte-range responses yet.
- **Experimental prototype with no stability promise** — the package is public, but its slots and copy can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `main` slot's `inject` is a factory (`() => injected`); the slot runtime flattens its return value together with `t` into the page props — passing the object instead of the factory fails the type. Media URLs always go through `workbenchFileUrl` (root stripping plus separator normalization); do not hand-build `?path=` queries in components. Bilingual ToC anchors keep English slugs.

</details>
