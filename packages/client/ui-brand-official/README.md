---
description: "Official DeepSeek Harness brand occupants for the sidebar and conversation hero, active only in official builds; for users and maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

This package fills the browser brand slots — `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` — with the product name and icon selected at build time. It registers for an `official` build or whenever [`oem.config.json`](../../../oem.config.json) supplies the projected brand name. A deployment changes that file and its referenced public image without replacing the slot package. It retains no runtime state and contributes nothing to model requests.

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

Mount this plugin in the browser roster, set `productName` and `brandIcon` in [`oem.config.json`](../../../oem.config.json), and run the normal client build.

### Choosing the profile

The build projects `productName` to `DSH_CLIENT_BRAND_NAME` and `brandIcon` to `DSH_CLIENT_BRAND_ICON` for the sidebar, Hero, login card, and framework-free boot page. Explicit environment values override the JSON fields for one build. A build with neither an official profile nor a projected brand name loads the plugin but leaves the slots empty.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the same three slots. Occupying a slot is the only composition route; there is no brand configuration surface here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The three occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on the sidebar and conversation declarations, so the set works whether this row activates before or after the declarers, withdraws all three occupants when either declaration collapses, and leaves no partial brand mix during HMR. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independently rendered** — the same OEM product name projects to `DSH_CLIENT_TITLE`, but the document title remains outside the UI slot system.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
