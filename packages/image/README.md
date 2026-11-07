---
description: "The image group map: the ctx.image generation seam and the model-facing generate_image tool, for users and maintainers navigating the group."
kind: "package-group"
---

# image/ — image-generation capability family

English | [中文](README.zh.md)

## Summary

The image group lets the chat model create pictures during a conversation. One service seam selects an image backend and returns encoded bytes; the model-facing tool turns a text prompt into one image, stores it as a durable attachment, and shows it to the user. The backends live with their transport owners: the Deepagens gateway route in `llm-deepagens` registers the `deepagens` provider.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`image`](image/README.md) | The generation seam: provider registry, execution-time selection, and the `ImageError` taxonomy | `ctx.image` |
| [`tool-image`](tool-image/README.md) | The model-facing `generate_image` tool | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Image generation subsystem](../../docs/subsystems/image.md) — `ctx.image` vocabulary, provider protocol, and generated Cordis API.
- [Web capability seam decision](../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — the registry and selection rules this seam follows.
- [`llm-deepagens` configuration](../llm/llm-deepagens/src/config.ts) — the gateway route that provides the shipped image backend through its `imageModel` setting.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The H3 video tools still call their own image backends; moving them onto `ctx.image` is open work.

</details>
