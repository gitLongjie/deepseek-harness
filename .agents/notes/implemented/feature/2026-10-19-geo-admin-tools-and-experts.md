# Agent Note: 深度云海 configuration moves to a settings card and the tools stop shelling out

Status: implemented

English | [中文](2026-10-19-geo-admin-tools-and-experts.zh.md)

## Problem

The 深度云海 experts shipped as preset compositions that published through the shell: the persona told the model to load a skill, read credentials from `D:\Project\GEO\web-admin-go\.env` (or `GEO_ADMIN_*` environment variables), sign in with `curl`, and POST the article itself. Three consequences followed.

There was no place in the product to configure the backend: the account and password lived in a backend project's `.env` on one machine, so a second install, a moved backend, or a non-developer user had nothing to fill in. The password appeared in tool-call arguments, and therefore in the session log, on every publish. And the expert could not do anything the skill did not spell out — no listing the account's articles, no checking a draft, no changing a published article — because every new operation meant another hand-written HTTP recipe.

## Decision

- **A host settings namespace owns the connection.** `@deepseek-ai/dsh-tool-geo-admin` ships `./settings`, a HOST row that registers the `geo-admin` namespace (`baseUrl`, `username`) and publishes its live value as `ctx.geoAdminSettings`. It sits in the deployment's web bundle beside the other host settings rows, because `settings.register` is once-per-process and a preset cannot own one. The launching environment seeds the composition base through `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME`, so headless runs keep working.
- **The password is a credential reference, not a field.** The settings document never carries it; the card writes it through the credentials domain under the fixed reference `GEO_ADMIN_PASSWORD`, and the tools resolve that reference on every call. Rotating the password reaches the next request without a restart, and no literal rides a settings response.
- **The backend is reached through typed tools, not shell.** The package's main entry registers thirteen model-facing tools — sites, article list/read/create/update/delete, categories, GEO keyword tasks (list, retry), and brand-visibility reports (list, read, generate, follow the job) — each signing in with the configured account and narrowing the backend's documented envelope field by field. A create is never retried (the endpoint has no idempotency key); both article write tools read the stored record back; a refused delete is reported as the backend's own reason. Every request asks the transport to refuse redirects, because the sign-in request carries the password and authenticated calls carry a bearer token.
- **The report and task routes proxy to the task service.** `web-admin-go` forwards `/api/v1/brand-visibility/*` and `/api/v1/geo-tasks*` to the task server, which answers `{code, message, data}` on its report routes and a flat page on GEO tasks. The client unwraps both and projects only the fields an operator acts on: task status and last error, report counts and QA window, the target brand's visibility score, and the ranking. Report generation returns a job; the model follows it with `geo_report_job` rather than blocking.
- **A card in the existing Plugins settings section edits the namespace.** `ui-settings-plugins` gains the `深度云海` card: two staged value fields and one write-only password control, keyed on the `geo-admin` namespace exactly like the H3 video card. A deployment that serves no `geo-admin` namespace renders no card.
- **The expert presets stop owning transport.** `article-publisher` (深度云海文章专家) drops its bash/pwsh rows for the tool row and now publishes through the tools; its setup script creates the least-privilege account and prints the credentials to enter on the card instead of writing the backend's `.env`. A new `geo-admin` expert (深度云海 GEO 专家) hires the same tools for reading, checking, and changing existing data. Both live under a new `geo/` package group.

## Alternatives considered

- **Materialize a private config file for the existing shell skill.** Rejected: it would duplicate the secret to a second plaintext file and hand the agent its path, which is exactly what the credentials seam exists to avoid. A tool that resolves the reference per call keeps the literal out of both the transcript and a second store.
- **Keep publishing in the shell and only add the card.** Rejected: a card without a consumer changes nothing for the user, and the typed tool is what removes the password from tool arguments.
- **Mount the tools per card by copying the package into the expert bundle.** Rejected: a preset cannot register a settings namespace, and a browser half in a standalone npm package would have to replicate the repository's client bundle preset, as the settings section README already records.
- **A bulk or destructive report API.** Not included: deletion addresses one article, and report generation starts one job per call; the tools never fan out on their own.

## Consequences

- The 深度云海 card is where the account lives; a fresh install configures nothing by editing files.
- Two models of the same backend now exist: the card's section (account/address) and the credential (password). Both resolve per operation, and a change on either reaches the next tool call.
- The card appears only when the deployment composes `@deepseek-ai/dsh-tool-geo-admin/settings`. A stock dsh profile that mounts the expert presets gets the tool rows but no namespace; the tools then fail with the Settings → Plugins → 深度云海 path in the message rather than silently doing nothing.
- Two expert packages ship: `@xmanrui/expert-article-publisher` (updated) and `@xmanrui/expert-geo-admin` (new). Both sync from `apps/desktop/config/agent-presets/`, and both presets mount `@deepseek-ai/dsh-tool-geo-admin`.
- The tools are covered by unit and registry-level tests with a scripted transport, and the card by controller and component tests. The route tables were read from the content backend's `handler/router.go` and `handler/admin/news.go` and from the task service's `internal/router/router.go` and `internal/handler/brand_visibility.go`; the endpoints are `GET/POST /api/v1/news`, `GET/PUT/DELETE /api/v1/news/{id}`, `GET /api/v1/categories`, `GET /api/v1/websites`, `GET /api/v1/geo-tasks`, `POST /api/v1/geo-tasks/{id}/retry`, `GET /api/v1/brand-visibility/admin/reports`, `GET /api/v1/brand-visibility/admin/reports/{id}`, `POST /api/v1/brand-visibility/report/generate`, and `GET /api/v1/brand-visibility/report/jobs/{id}`.

## References

- Implementation: `packages/geo/tool-geo-admin/src/{index,settings,http,types,errors}.ts`
- Card: `packages/client/ui-settings-plugins/src/client/{GeoAdminCard.tsx,geo-admin-card-controller.ts,locales.ts}`
- Composition: `packages/bundle/web-app/cordis.patch.yml` (`geo-admin-settings` row), `apps/desktop/config/agent-presets/{article-publisher,geo-admin}/agent.cordis.yml`
- Expert packages: `experts/expert-article-publisher/`, `experts/expert-geo-admin/`
- Backend contract: `D:\Project\GEO\web-admin-go\handler\router.go` (mounts and permissions), `handler/admin/news.go` (list/create/update/delete handlers), `D:\Project\GEO\generate_article_server_go\internal\router\router.go` (GEO task and report routes), `internal\handler\brand_visibility.go` (report list/read/generate handlers)
- Related: `2026-09-19-expert-presets-stay-out-of-mode-surfaces.md` (the expert card stays out of mode menus)
