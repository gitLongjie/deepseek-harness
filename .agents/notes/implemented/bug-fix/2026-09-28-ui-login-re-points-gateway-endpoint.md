# Agent Note: the login flow re-points the deepagens endpoint even when the catalog read is refused

Status: implemented

English | [中文](2026-09-28-ui-login-re-points-gateway-endpoint.zh.md)

## Problem

`LoginStore.syncCatalogFromGateway` returned at the first refusal: when `discoverModels` answered `!ok`, the whole sync aborted before any settings write. The credentials had already moved — `credentialAdapter.apply` stores the fresh key and the sign-in gateway's origin before the sync runs — so a deployment that changed its `loginUrl` (oem.config.json, baked as `DSH_CLIENT_LOGIN_URL`) signed in against the new gateway while `llm-deepagens.baseURL` in `~/.dsh/settings.yaml` still named the previous one. The Deepagens deployment saw exactly this: after moving the login endpoint from a local claw gateway (`http://localhost:31000`) to `https://claw.deepagens.com`, the Models page kept showing the loopback base, and every deepagens request would carry the new gateway's key to the old address.

## Decision

The endpoint follows the sign-in unconditionally. After a successful login, `syncCatalogFromGateway` writes `llm-deepagens.baseURL = <login-origin>/v1` whenever the stored value differs, regardless of the catalog read's outcome; the `models` write still happens only when discovery succeeded and the listing changed. A refused or failing discovery logs its message and leaves the stored catalog alone.

## Alternatives considered

**Keep the abort on refused discovery.** Rejected: credentials and endpoint describe the same fact (which gateway this key belongs to) and are applied at the same moment; letting one move while the other stays is a torn state every later request pays for.

**Also clear the stored catalog when discovery is refused.** Rejected: stale model rows are inert metadata (nothing serves them until the endpoint answers again), and the next successful discovery replaces them in full. Deleting them would blank the selector for no gain.

## Consequences

- Changing `loginUrl` takes effect for the route endpoint at the next sign-in (launch replay included), even while the gateway still refuses the issued key for `/v1/models`.
- A sign-in against a gateway whose listing is unreadable now shows the correct base with the previously stored catalog, instead of a stale base with that same catalog.
- The discovery-refusal warn now carries the wrapped error's message (HTTP status and key hint) next to the `llm/model-discovery-rejected` code, so the desktop log names the gateway's own verdict.

## Testing

The login-models spec gains `storedBaseURL` on its settings mock. "skips the write" cases now pin the endpoint too (unchanged endpoint + unchanged catalog still writes nothing); a new case proves a refused discovery re-points a stale base with a single `set baseURL` op and no default adoption; the discovery-rejection case keeps the sign-in and the stored state.
