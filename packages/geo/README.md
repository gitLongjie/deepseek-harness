---
description: "Package map for the geo capability family: model-facing tools over the 深度云海 GEO multi-site content backend, plus the settings namespace and credential reference they read."
kind: "package-group"
---

# geo/ — GEO content-backend family

English | [中文](README.zh.md)

## Summary

The `geo/` packages connect an agent to a 深度云海 GEO multi-site content backend. The family owns the model-facing `geo_*` tools (sites, articles, categories), the `geo-admin` settings namespace that names the backend and the publishing account, and the `GEO_ADMIN_PASSWORD` credential reference those tools resolve on every call. The backend keeps authority: the signed-in account's permissions decide what the tools can read or change.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-geo-admin/`](tool-geo-admin/README.md) | Exposes the site, article, and category tools; its `./settings` host entry registers the `geo-admin` settings namespace | registers on `ctx.tools`; publishes `ctx.geoAdminSettings` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Tool catalog](../../docs/tool-catalog.md) — every model-facing tool with its schemas.
- [`tool-geo-admin/`](tool-geo-admin/README.md) — the `geo-admin` settings fields and the credential reference.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
