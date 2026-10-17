# Agent Note: The sign-in gateway owns its own credential reference

Status: implemented

English | [中文](2026-10-17-login-gateway-credential-reference.zh.md)

## Problem

A user who typed their own DeepSeek API key into Settings → Models lost it at the next launch. The Models card stores a typed key under the reference the route's resolved profile names, which for the DeepSeek route is `DEEPSEEK_API_KEY` (`packages/llm/llm-deepseek/src/config.ts`). The Deepagens Claw gateway is a second route of the same plugin over its own `llm-deepagens` settings section, and it declared no reference of its own, so the shared schema default made it resolve that same `DEEPSEEK_API_KEY`.

`ui-login` replays the stored account pair on every launch (`LoginStore.restore` → `login`) and, after each successful sign-in, wrote the gateway-issued key and the endpoint origin to `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL`. Every launch therefore replaced the DeepSeek route's stored key with the gateway's key, and sign-out deleted it. The origin write bought nothing: `resolveAdapterOptions` reads `$DEEPSEEK_BASE_URL` from the trusted launch environment and never from the credential store, while the catalog sync already writes the gateway endpoint into `llm-deepagens.baseURL`.

## Decision

The gateway route owns a credential reference. `DEEPAGENS_API_KEY_ENV` (`DEEPAGENS_API_KEY`) joins the route's composition base beside the `chat-completions` pin, so the route's resolved profile names it and the Models card reports and writes that reference. The login plugin writes only `LOGIN_CREDENTIAL_REFS` — now just `DEEPAGENS_API_KEY` — and writes no base-URL credential. `DEEPSEEK_API_KEY` means exactly what the DeepSeek card says: that route's key.

A credential store that still holds the gateway's key under `DEEPSEEK_API_KEY` now reads it as a DeepSeek-route key, and the next launch's silent re-login writes the gateway's current key to `DEEPAGENS_API_KEY`.

## Alternatives considered

- **Apply credentials only on an interactive sign-in, never on the launch replay.** The account server issues the key at each sign-in, and the replay is what keeps a rotated key current; skipping its write would leave the gateway route holding a stale key until the user signed in by hand.
- **Skip the write when the stored value already differs from the issued key.** `CredentialInfo` reports configured, source, and writability only, so the plugin cannot tell a key the user stored from one a previous launch issued.
- **Keep the endpoint credential under a new name (`DEEPAGENS_BASE_URL`).** Nothing reads a base-URL credential: the adapter resolves its endpoint from the settings section and the launch environment, and the catalog sync owns the gateway's `baseURL`.

## Consequences

- A launch-time re-login no longer rewrites the DeepSeek route's key, and sign-out removes only the gateway's own reference.
- The Models page's Deepagens card now shows and stores `DEEPAGENS_API_KEY`, so its configured badge follows the gateway key rather than the DeepSeek one.
- An install whose only gateway key sits under `DEEPSEEK_API_KEY` shows that key as the DeepSeek route's key until the user replaces it; the gateway route reads `DEEPAGENS_API_KEY`, which the next sign-in writes. A refused credential write still aborts sign-in loudly.
- `DEEPAGENS_API_KEY` stays the login plugin's reference: the launch re-login writes it and sign-out removes it. A deployment that wants the gateway route to hold a key of its own names another reference in that route's `apiKeyEnv`, because the credential seam reports presence only — no provenance a plugin could use to leave a hand-stored value alone.
- The default-model adoption this plugin also performs is unchanged; its accepted trade-off remains recorded in [the login default-model note](../feature/2026-09-23-login-adopts-first-gateway-model-as-default.md).
- `packages/client/ui-login/tests/browser-plugin.client.spec.ts` pins the exact references a sign-in writes and unsets, and `packages/llm/llm-deepseek/tests/dynamic-config.spec.ts` pins that the gateway route authenticates from `DEEPAGENS_API_KEY` while a stored `DEEPSEEK_API_KEY` does not reach it.
