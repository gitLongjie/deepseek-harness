# Agent Note: The API-key route no longer follows the official model listing

Status: implemented

English | [中文](2026-10-22-deepseek-official-model-listing.zh.md)

## Problem

The `deepseek-official` route offered whatever its `models` setting held, and that setting defaults to the catalog bundled with each build. A model the DeepSeek API added reached API-key users only through a release, while the account route already followed the service's `GET /models` listing at the same origin. Unlike the account route's catalog, the official route's catalog is user-editable: the Models page stores an edited catalog in `models`, and a gateway behind `baseURL` declares its models there.

## Decision

The API-key route does not request `GET /models`. [That withdrawal](../simplification/2026-11-04-api-key-route-skips-model-listing.md) replaces the follow this note originally recorded. The account route still follows `GET /models` through the shared Messages transport.

## Alternatives considered

These alternatives were set aside in favor of following the listing. That follow is withdrawn; they remain as the record of how it was shaped.

**Follow the listing on every endpoint.** A gateway that publishes an OpenAI-style `/models` returns entries without `api_capabilities.anthropic_messages`, which the decoder hides, so the route would offer no models. Every such gateway would also receive an extra request carrying the key.

**Merge the customized catalog with the listing by model id.** Customized users would keep receiving new listed models, but a model the user deleted would return, and the Models page cannot hide one listed model.

**Mark an unset `models` by removing its schema default.** An absent value would select the listing without comparing catalogs, but the Models page would lose the inherited rows it shows and copies, with their hidden `systemPromptUpdate` and `toolUpdate` fields, into a customized catalog. Rows copied from the generic model-discovery API would drop those fields.

**Fetch once per process, or refresh on a timer.** A single fetch leaves a long-running Web or desktop host on its startup catalog, and one transient failure pins it to the built-in catalog. A timer sends requests while the route is idle. Access-triggered background refresh matches the account route.

**Reuse the cached listing after Restore defaults.** The cache could serve a listing loaded before the customization for up to `modelsMaxAgeMs`; the request is cheap, so restoring always reloads it. The reload starts on the next access rather than inside the listener, which keeps credential lookup and its failures on the request path; the Web page's settings refresh makes that access right after the save.

## Consequences

- API-key users receive the configured catalog. A model the service adds later arrives when a release updates the built-in catalog or the deployment sets `models`.
- The account route still receives listed models without a release. Its listing cache, client-version gate, and refresh stay in the shared transport.
- A suite that boots the account route on the official endpoint must answer the listing itself. The API-key route does not request it.
