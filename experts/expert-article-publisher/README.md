---
description: "深度Work expert package: publishes the article publisher (深度云海文章专家) as an installable expert card for the dsh expert market."
kind: "package-reference"
---

# @xmanrui/expert-article-publisher

English | [中文](README.zh.md)

## Summary

`@xmanrui/expert-article-publisher` publishes 深度云海文章专家 as a downloadable, hireable expert card for the dsh expert market. The packaged `experts/article-publisher/` is a complete expert directory — `preset.yml` card metadata, the `agent.cordis.yml` composition, and the `skills/` toolbox (the `geo-article-publish` workflow plus API references and a one-time account setup script) — and the package ships a micro mount plugin that, on every host start, syncs the expert directory into the harness home's user preset root (`.agent-presets`), where the preset roster's user root discovers it on its next read (trust: user). The expert page renders and hires it through the existing agentPresets projection and staging machinery; the package adds no model-facing mechanism of its own.

The expert writes articles, or accepts a user-provided one, and publishes them to a running `web-admin-go` multi-site backend through the `geo_*` tools (`@deepseek-ai/dsh-tool-geo-admin`), targeting a chosen `website_id`. The backend address and account come from the 深度云海 card on the Settings → Plugins page, and the password lives in the credential store under `GEO_ADMIN_PASSWORD`, resolved per call — no credential literal reaches the transcript. `skills/geo-article-publish/scripts/setup-account.ps1` creates the dedicated least-privilege publishing account (role 内容编辑) once per backend and prints the credentials to enter on that card.

## Use this package

Install through the plugin market (or `pnpm add @xmanrui/expert-article-publisher` into a managed profile and restart the host). The expert appears on the expert page; hiring into a new chat composes it for real. Create the publishing account and fill Settings → Plugins → 深度云海 once per backend before the expert's first publish.

`dsh.expert.roots` declares the packaged expert roots; `dsh.bundle.patch` declares the activation patch — `!!js` anchoring after the archify skill-root precedent, so the package carries no dependency on the harness itself.

## Publishing

`npm run build` syncs the expert content from the deployment's source of truth (`apps/desktop/config/agent-presets/article-publisher/`); `npm publish` releases. Server-side, add the contents of `store-entry.json` to the DSH 1024Store `/api/v1/plugins` listing (`category: "expert"`) so client markets can browse and install it.

## Known Limitations

- The sync never deletes: uninstalling the package leaves the last-synced expert directory in the user preset root, removable in the preset authoring UI.
- `avatar`/`subtitle`/`badge` ship in the package today; the roster projection carries them with the marketplace-install work and ignores unknown fields until then, so cards fall back to the glyph avatar.
- The preset mounts `@deepseek-ai/dsh-tool-geo-admin`, so the deployment must compose that package and its `geo-admin` settings row (the 深度云海 build does). A stock dsh profile without them mounts the expert without its publishing tools.
- The account is entered once on the settings card; the launching environment still seeds the composition base through `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME`, and `GEO_ADMIN_PASSWORD` still resolves from the environment for headless runs.