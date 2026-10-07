---
description: "The video group map: MiniMax H3 segment generation — the ctx.h3Video seam with its local and hosted providers, the model-facing video tools, and the workbench routes — for users and maintainers navigating the group."
kind: "package-group"
---

# video/ — video-generation capability family

English | [中文](README.zh.md)

## Summary

The video group turns a conversation into a rendered film with MiniMax H3. One service seam generates a segment through either a local ComfyUI deployment or the hosted MiniMax API, routing each segment explicitly and assembling finished segments with ffmpeg; the model-facing tools above it structure the storyboard, establish its visual materials, submit renders as background jobs, and concat the result; the workbench projects the output directory into the Web GUI without granting the browser a write path. The group splits into the seam with its providers (`h3-video`), its consumer (`tool-video`), and the read-only projection (`video-workbench`).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`h3-video`](h3-video/README.md) | The generation seam: `ctx.h3Video`, local ComfyUI and hosted MiniMax providers, explicit routing, ffmpeg assembly, and the `./settings` entry | `ctx.h3Video` |
| [`tool-video`](tool-video/README.md) | The model-facing `video_plan`, `video_keyframes`, `video_assets`, `video_asset_images`, `video_render`, and `video_assemble` tools plus the `/video` command | registers on `ctx.tools` |
| [`video-workbench`](video-workbench/README.md) | Read-only web-server routes projecting the H3 output directory for the Web GUI | — |

The browser half of the workbench lives with the other Web plugins: [`client/ui-video-workbench`](../client/ui-video-workbench/README.md).

-----

<a id="related-documentation"></a>
## Related documentation

- [H3 video generation tools](../../.agents/notes/implemented/feature/2026-09-29-h3-video-generation-tools.md) — the seam, its providers, the tools, and the materials-first flow.
- [H3 video user settings](../../.agents/notes/implemented/feature/2026-10-03-h3-video-user-settings.md) — the `./settings` host entry and its overlay over the composition config.
- [H3 generation alignment with oh-story-dsh](../../.agents/notes/implemented/feature/2026-10-06-h3-video-oh-story-alignment.md) — capability envelopes, protocol validation, and reference conditioning.
- [Video workbench](../../.agents/notes/implemented/feature/2026-10-06-video-workbench.md) — the read-only projection and its containment rules.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The group has no `docs/subsystems/` page yet; its service contract lives in the `h3-video` package README and the Agent Notes above. A subsystem reference can follow when the seam's types need a home outside the package README.

</details>
