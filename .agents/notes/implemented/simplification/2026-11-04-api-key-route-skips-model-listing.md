# Agent Note: The API-key route does not request the official model listing

Status: implemented

English | [中文](2026-11-04-api-key-route-skips-model-listing.zh.md)

## Problem

`llm-deepseek-api-key` requested `GET https://api.deepseek.com/models` whenever a stored API key was present and `models` still matched the built-in catalog. That listing authenticates with `Authorization: Bearer`. The route sent `x-api-key`, the header Messages uses. The endpoint answered HTTP 401, the route warned that the stored credential was rejected, and it served the bundled catalog anyway. Refresh repeated the request.

## Decision

- [`llm-deepseek-api-key`](../../../../packages/llm/llm-deepseek-api-key/README.md) does not request `GET /models`. Discovery and model resolution serve the configured `models` catalog. The default is the built-in catalog, `deepseek-flash` and `deepseek-v4-pro`. A missing key still hides the route from model selectors.
- `modelsTimeoutMs` and `modelsMaxAgeMs` remain accepted and validated so existing configuration loads. They do not send a listing request.
- The [account route](../architecture/2026-09-24-deepseek-account-remote-model-catalog.md) still follows its `/models` listing. The shared listing cache stays in the Messages transport for that route.
- This withdraws the API-key follow recorded in [the official listing note](../architecture/2026-10-22-deepseek-official-model-listing.md).

## Alternatives considered

**Keep the request and stop after HTTP 401 or 403.** Each process would still send one rejected request and print the credential warning. That request is the one this decision removes.

**Send `Authorization: Bearer` so the listing succeeds.** A valid key would then receive listed models. The request would continue. Messages authentication stays `x-api-key`.

**Drop `modelsTimeoutMs` and `modelsMaxAgeMs` from the API-key configuration.** Stored profiles that set those fields would fail to load or lose them. They stay accepted and unused.

## Consequences

- API-key users on the official endpoint no longer wait on or warn about `GET /models`. They receive the configured catalog.
- A model the service adds later reaches API-key users when a release updates the built-in catalog, or when the deployment sets `models`.
- The account route's listing, refresh, and client-version gate are unchanged.
