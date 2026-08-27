# Agent Note: Browser login gate over the Deepagens Claw account server

Status: implemented

English | [中文](2026-08-25-client-login-gate.zh.md)

## Problem

The web and desktop clients had no account concept: a deployment fronted by the Deepagens Claw token gateway (`https://claw.deepagens.com/`) still required each user to paste an API key into the Models settings page. The product needs a sign-in page when no session exists, the signed-in avatar and display name in the shell, and a sign-out path — on both the web app and the Electron desktop app without forking the frontend.

## Decision

Login lives entirely in one client plugin, `@deepseek-ai/dsh-client-ui-login` — no new wire domain on the host. The browser POSTs the typed credentials directly to the account server's existing endpoint `POST /api/user/deepagens-claw/login` (contract: `{username, password}` → `{success, message?, data: {display_name?, avatar?, api_key}}`), so the desktop app inherits the flow by sharing the same plugin bundles. The endpoint URL is a build-environment value, `DSH_CLIENT_LOGIN_URL`, consumed the same way `DSH_CLIENT_BUILD_PROFILE` is; a build without it loads the plugin but registers nothing.

The UI occupies two existing additive seats rather than new ones: the full-page sign-in takeover renders into `shell.overlay` (its backdrop re-enables pointer events because that layer is click-through by design), and the account row — avatar or initial fallback, display name in wide mode, sign-out dropdown — renders into `sidebar.footer.action` beside Settings. Both install through declaration-aware `slots.inject()`, so activation order relative to ui-layout and ui-sidebar is unconstrained.

Session handoff reuses the credentials seam: a successful sign-in writes `DEEPSEEK_API_KEY` (the issued key) and `DEEPSEEK_BASE_URL` (the endpoint's origin) through the existing `credentials.set` wire method — the same writable layer the Models page uses — and sign-out unsets both. A rejected write aborts the sign-in loudly (`credential-rejected` surfaces as an error, the session is not persisted), honoring the fail-loud rule instead of leaving a half-signed-in state. The display profile (display name, avatar URL, key) persists in `localStorage` and is treated as untrusted display data; nothing model-visible depends on it.

## Alternatives considered

The alternatives below were considered and not taken; the headings satisfy the note format while keeping the reasoning.

### What we gave up

- **No host-side auth domain.** A typed `auth.*` RPC surface (login/getSelf/logout with server-side session replay and avatar refresh) was considered and deferred: it would add a contract + zod schema + handler + client + coverage set across `dsh-host-apiproxy` for a flow the client can run itself, and the browser-direct call keeps CORS as the only deployment requirement.
- **No live profile refresh.** Server-side renames or avatar changes appear after the next sign-in; the stored profile is display-only.
- **The server session cookie is not replayed** against other account endpoints by this plugin.

## Consequences

Every build now gates the app behind sign-in against the deployment's account server and signs the issued key into the credential layer, so provider routing follows the account server without per-user key entry; only a build that empties `DSH_CLIENT_LOGIN_URL` opts out.
