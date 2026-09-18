---
description: "深度Work expert package: publishes the article publisher (深度云海文章专家) as an installable expert card for the dsh expert market."
kind: "package-reference"
---

# @xmanrui/expert-article-publisher

English | [中文](README.zh.md)

## Summary

`@xmanrui/expert-article-publisher` publishes 深度云海文章专家 as a downloadable, hireable expert card for the dsh expert market. The packaged `experts/article-publisher/` is a complete expert directory — `preset.yml` card metadata, the `agent.cordis.yml` composition, and the `skills/` toolbox (the `geo-article-publish` workflow plus API references and a one-time account setup script) — and the package ships a micro mount plugin that, on every host start, syncs the expert directory into the harness home's user preset root (`.agent-presets`), where the preset roster's user root discovers it on its next read (trust: user). The expert page renders and hires it through the existing agentPresets projection and staging machinery; the package adds no model-facing mechanism of its own.

The expert writes articles, or accepts a user-provided one, and publishes them to a running `web-admin-go` multi-site backend via `POST /api/v1/news`, targeting a chosen `website_id`. Authentication is a dedicated least-privilege account (role 内容编辑) whose credentials are written to the target project's `.env` by `skills/geo-article-publish/scripts/setup-account.ps1`.

## Use this package

Install through the plugin market (or `pnpm add @xmanrui/expert-article-publisher` into a managed profile and restart the host). The expert appears on the expert page; hiring into a new chat composes it for real. Run the account setup once per backend before the expert's first publish.

`dsh.expert.roots` declares the packaged expert roots; `dsh.bundle.patch` declares the activation patch — `!!js` anchoring after the archify skill-root precedent, so the package carries no dependency on the harness itself.

## Publishing

`npm run build` syncs the expert content from the deployment's source of truth (`apps/desktop/config/agent-presets/article-publisher/`); `npm publish` releases. Server-side, add the contents of `store-entry.json` to the DSH 1024Store `/api/v1/plugins` listing (`category: "expert"`) so client markets can browse and install it.

## Known Limitations

- The sync never deletes: uninstalling the package leaves the last-synced expert directory in the user preset root, removable in the preset authoring UI.
- `avatar`/`subtitle`/`badge` ship in the package today; the roster projection carries them with the marketplace-install work and ignores unknown fields until then, so cards fall back to the glyph avatar.
- The backend base URL and bot credentials default to `http://localhost:8001` and the project `.env`; override with `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME` / `GEO_ADMIN_PASSWORD` when the backend or credentials live elsewhere.