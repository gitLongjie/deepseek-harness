# @deepseek-ai/dsh-client-ui-login

English | [中文](README.zh.md)

This package registers the account sign-in flow against the deployment's account server. The repository [`oem.config.json`](../../../oem.config.json) owns the default endpoint, product name, shared `brandIcon`, and Chinese and English `loginTagline` copy. The login card renders that icon and the active locale's tagline; an explicit `DSH_CLIENT_LOGIN_URL` overrides the endpoint, and an empty override loads the plugin but registers nothing.

Two occupants install through declaration-aware `slots.inject()` calls, so activation order relative to ui-layout and ui-sidebar does not matter and teardown withdraws both:

- `shell.overlay` — a full-page sign-in takeover (brand mark, username/password form, server messages shown verbatim). The backdrop re-enables pointer events because the overlay layer is click-through by design, and it respects a desktop shell's published top inset so the window title bar remains available. It renders nothing while a session is signed in.
- `sidebar.footer.action` — the signed-in account row: avatar (or its initial fallback), display name in wide mode, and a dropdown with the sign-out action.

A successful sign-in (wire contract: `POST {username, password}` → `{success, message?, data: {display_name?, avatar?, api_key}}`) stores the profile in `localStorage` and writes `DEEPSEEK_API_KEY` plus `DEEPSEEK_BASE_URL` (the endpoint's origin) through the existing `credentials.set` wire method — the same writable layer the Models settings page uses. A rejected write aborts the sign-in loudly. Sign-out unsets both references and drops the stored profile.

The endpoint must allow cross-origin calls from the app origin (CORS with JSON content type); the fetch failure path reports an unreachable service instead of breaking the page.

## Model Experience

None, as the package contributes browser presentation and a credential handoff only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No session refresh** — the stored profile is display-only; a server-side rename or avatar change appears after the next sign-in.
- **No registration entry** — accounts are issued by the account server; the sign-in card deliberately offers no sign-up link.
- **Bearer-session calls are out of scope** — the account server's session cookie is not replayed against other endpoints by this package.
