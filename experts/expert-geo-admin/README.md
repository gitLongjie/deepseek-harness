---
description: "深度Work expert package: publishes the GEO data operator (深度云海 GEO 专家) as an installable expert card for the dsh expert market."
kind: "package-reference"
---

# @xmanrui/expert-geo-admin

English | [中文](README.zh.md)

## Summary

`@xmanrui/expert-geo-admin` publishes 深度云海 GEO 专家 as a downloadable, hireable expert card for the dsh expert market. The packaged `experts/geo-admin/` is a complete expert directory — `preset.yml` card metadata, the `agent.cordis.yml` composition, and the `skills/` toolbox (the `geo-admin-data` backend workflow and the `geo-outbound-prospecting` overseas-prospecting flow) — and the package ships a micro mount plugin that, on every host start, syncs the expert directory into the harness home's user preset root (`.agent-presets`), where the preset roster's user root discovers it on its next read (trust: user). The expert page renders and hires it through the existing agentPresets projection and staging machinery; the package adds no model-facing mechanism of its own.

The expert queries and changes the GEO multi-site content backend through the `geo_*` tools (`@deepseek-ai/dsh-tool-geo-admin`): list sites, list and read articles, list categories, create, update, or delete an article, list GEO keyword tasks and retry one, and list, read, or generate brand-visibility reports (following the generation job). It also mounts `web_search` and `web_fetch` (`@deepseek-ai/dsh-tool-web`) for public-web background; search is pinned to the claw gateway `/v1/tools/search` route and page fetch stays local HTTP, while persisted backend state still comes from `geo_*`. The backend address and account come from the 深度云海 card on the Settings → Plugins page, and the password lives in the credential store under `GEO_ADMIN_PASSWORD`, resolved per call — tool results never return the stored password. Missing fields can be supplied in chat and saved with `geo_configure`; chat-supplied passwords enter Session history, while the settings card offers private password entry.

## Use this package

Install through the plugin market (or `pnpm add @xmanrui/expert-geo-admin` into a managed profile and restart the host). The expert appears on the expert page; hiring into a new chat composes it for real. Fill the backend address, account, and password once on Settings → Plugins → 深度云海.

`dsh.expert.roots` declares the packaged expert roots; `dsh.bundle.patch` declares the activation patch — `!!js` anchoring after the archify skill-root precedent, so the package carries no dependency on the harness itself.

## Publishing

`npm run build` syncs the expert content from the deployment's source of truth (`apps/desktop/config/agent-presets/geo-admin/`); `npm publish` releases. Server-side, add the contents of `store-entry.json` to the DSH 1024Store `/api/v1/plugins` listing (`category: "expert"`) so client markets can browse and install it.

## Known Limitations

- The sync never deletes: uninstalling the package leaves the last-synced expert directory in the user preset root, removable in the preset authoring UI.
- `avatar`/`subtitle`/`badge` ship in the package today; the roster projection carries them with the marketplace-install work and ignores unknown fields until then, so cards fall back to the glyph avatar.
- The preset mounts `@deepseek-ai/dsh-tool-geo-admin` and `@deepseek-ai/dsh-tool-web`; the deployment must compose the geo-admin tools and host `web` search/fetch providers (the 深度云海 build does). A stock dsh profile without them mounts the expert without the corresponding tools.
- The card does not delete articles, change accounts, roles, permissions, or site configuration; those stay in the backend's own admin pages.
