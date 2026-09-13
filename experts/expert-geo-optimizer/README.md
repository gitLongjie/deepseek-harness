---
description: "深度Work expert package: publishes the GEO optimizer as an installable expert card for the dsh expert market."
kind: "package-reference"
---

# @xmanrui/expert-geo-optimizer

English | [中文](README.zh.md)

## Summary

`@xmanrui/expert-geo-optimizer` is the first expert package: it publishes the GEO optimizer as a downloadable, hireable expert card for the dsh expert market. The packaged `experts/geo-optimizer/` is a complete expert directory — `preset.yml` card metadata, the `agent.cordis.yml` composition, and the `skills/` toolbox — and the package ships a micro mount plugin that, on every host start, syncs the expert directory into the harness home's user preset root (`.agent-presets`), where the preset roster's user root discovers it on its next read (trust: user). The expert page renders and hires it through the existing agentPresets projection and staging machinery; the package adds no model-facing mechanism of its own.

## Use this package

Install through the plugin market (or `pnpm add @xmanrui/expert-geo-optimizer` into a managed profile and restart the host). The GEO optimizer appears at the top of the expert page, its card matching the deployment's reference expert; hiring into a new chat composes it for real.

`dsh.expert.roots` declares the packaged expert roots; `dsh.bundle.patch` declares the activation patch — `!!js` anchoring after the archify skill-root precedent, so the package carries no dependency on the harness itself.

## Publishing

`npm run build` syncs the expert content from the deployment's source of truth (`apps/desktop/config/agent-presets/geo-optimizer/`); `npm publish` releases. Server-side, add the contents of `store-entry.json` to the DSH 1024Store `/api/v1/plugins` listing (`category: "expert"`) so client markets can browse and install it.

## Known Limitations

- The sync never deletes: uninstalling the package leaves the last-synced expert directory in the user preset root, removable in the preset authoring UI.
- `avatar`/`subtitle`/`badge` ship in the package today; the roster projection carries them with the marketplace-install work and ignores unknown fields until then, so cards fall back to the glyph avatar.
