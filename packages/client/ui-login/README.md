---
description: "Sign-in plugin for the dsh web client: a full-page login takeover and a signed-in account row wired to the deployment's account server through the OEM config."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-login

English | [中文](README.zh.md)

## Summary

This package registers the account sign-in flow against the deployment's account server. The repository [`oem.config.json`](../../../oem.config.json) owns the default endpoint, product name, shared `brandIcon`, and Chinese and English `loginTagline` copy. The login card renders that icon and the active locale's tagline; an explicit `DSH_CLIENT_LOGIN_URL` overrides the endpoint, and an empty override loads the plugin but registers nothing.

## Table of Contents

Two occupants install through declaration-aware `slots.inject()` calls, so activation order relative to ui-layout and ui-sidebar does not matter and teardown withdraws both:

- `shell.overlay` — a full-page sign-in takeover (brand mark, username/password form with a show-password toggle, server messages shown verbatim). The backdrop re-enables pointer events because the overlay layer is click-through by design, and it respects a desktop shell's published top inset so the window title bar remains available. While the boot-time session restore is in flight it renders only the backdrop; it renders nothing once a session is signed in.
- `sidebar.footer.action` — the signed-in account row: avatar (or its initial fallback), display name in wide mode, and a dropdown with the sign-out action.

A successful sign-in (wire contract: `POST {username, password}` → `{success, message?, data: {display_name?, avatar?, api_key}}`) keeps the session in memory and stores the typed pair, the issued key, and the profile in `localStorage`, then writes `DEEPAGENS_API_KEY` through the existing `credentials.set` wire method — the same writable layer the Models settings page uses, under the gateway route's own reference. `DEEPSEEK_API_KEY` is deliberately untouched: it belongs to the DeepSeek route, and a launch-time sign-in that wrote it replaced the key a user stored there. The gateway endpoint needs no credential entry because the catalog sync writes it into the route's `llm-deepagens` settings section. A rejected write aborts the sign-in loudly. Sign-out unsets `DEEPAGENS_API_KEY` and drops the stored record, leaving every other stored credential in place.

Every launch revalidates the stored key with one `GET /v1/models` read before the UI settles. An accepted key signs in and enters the app without the card, and without the `POST` the account server charges a login session for; the gateway catalog sync still runs on that key. A refused key (revoked, expired, short of quota) replays the stored pair through the sign-in endpoint and stores the key that sign-in issues. A refused pair keeps the record stored for the next launch and falls back to the sign-in card with the failure showing, and a record written before key reuse — a pair without a key — replays once and gains one.

The endpoint must allow cross-origin calls from the app origin (CORS with JSON content type); the fetch failure path reports an unreachable service instead of breaking the page.

The Models page's Deepagens card carries a "follow the sign-in gateway catalog" switch backed by `llm-deepagens`'s `followGatewayCatalog` field (default on). An explicit `false` hands the route to the user: sign-ins stop re-pointing `baseURL`, replacing `models`, and adopting a gateway default model, so the card's edits survive every launch's catalog sync.

## Model Experience

Indirectly, through the settings namespaces a sign-in writes: the pulled gateway catalog lands in the `llm-deepagens` provider settings (its own selector group), and a default model the pulled catalog does not serve is re-pointed at its first model in `agent-default-model`; the package never assembles a provider request itself.

#### KV Cache effect

The default-model adoption happens before any session exists, so it changes which route a first session assembles rather than any request's content; later manual picks own their own cache effects.

## Known Limitations and Deferred Work

- **No session refresh** — the profile is display-only; a server-side rename or avatar change appears after the next pair replay (a refused key or a manual sign-in), not on a key revalidation.
- **No registration entry** — accounts are issued by the account server; the sign-in card deliberately offers no sign-up link.
- **Bearer-session calls are out of scope** — the account server's session cookie is not replayed against other endpoints by this package.

### Dev Note

The two occupants observe one in-memory session store; sign-out nulls the session once for both surfaces. The stored `localStorage` record feeds the launch-time key revalidation and the pair replay behind it — the session itself never persists.
