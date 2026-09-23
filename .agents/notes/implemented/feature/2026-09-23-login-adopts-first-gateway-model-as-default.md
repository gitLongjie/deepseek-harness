# Agent Note: Login adopts the first gateway model as the default

Status: implemented

English | [中文](2026-09-23-login-adopts-first-gateway-model-as-default.zh.md)

## Problem

A fresh install composes the default Agent model as the static DeepSeek route (`deepseek-official` / `deepseek-flash`, the `agent-default-model` row in the base bundle). The Deepagens desktop never serves that route: its account session carries the gateway key, and the usable models are the ones the login flow pulls into `llm-deepagens`. Until the user manually picked a model, every new session started on a default whose provider could not serve it — the model selector showed a default the account could not run.

## Decision

The login store's gateway sync now also owns the default-model adoption. After a discovery that lists models, it reads the `agent-default-model` descriptor from the same settings describe that guards the catalog write, and when the current selection is not a model the pulled catalog serves, it replaces that namespace's user section with `{ provider: 'deepagens', model: <first pulled id> }` under the descriptor's revision. The adoption runs on every successful discovery, including the unchanged-catalog path, so an install whose earlier default write failed heals at the next sign-in.

The guard is provider-aware on purpose: a selection counts as served only when its provider is the gateway route and its model id appears in the pulled catalog. A same-id model on another route does not satisfy it, so the adoption re-points it. An empty discovery, a missing namespace, a refused write, or a revision conflict keeps the previous default and logs the refusal; none of these can fail the sign-in.

## Alternatives considered

**Change the composition entry to the gateway route.** The bundle composes before any login, so it cannot know the pulled model ids, and a gateway-provider entry with an empty catalog fails sessions before the first sign-in instead of after.

**Always overwrite with the first pulled model.** Resets a user's deliberate pick to model #1 on every re-login where the gateway catalog changed; the guard keeps exactly one behavior for the install case without that cost.

**Adopt on the Host side when the seeded catalog lands.** The host cannot tell a login-seeded catalog write from a user edit of the same namespace, so the decision would need a new signal on the settings seam; the client already holds both facts — the pulled list and the descriptor — at adoption time.

**Fall back at session creation when the default is not routable.** A silent resolution-time fallback hides the mismatch the default is supposed to surface and contradicts fail-loud composition; the adoption instead fixes the stored fact once, where the fresh default is known.

## Consequences

A fresh install ends its first sign-in with a usable default, and existing installs converge at their next sign-in. A user who deliberately picks a model the gateway does not serve loses that pick at the following sign-in — accepted, because the gateway models are the routes the account session can run. The `replace` drops a stored `reasoningEffort` together with the overwritten selection; the next manual pick restores one.

## Testing

`packages/client/ui-login/tests/login-models.client.spec.ts` pins the adoption under the unchanged catalog, the served-default keep (including a stored `reasoningEffort`), the same-id other-route re-point, the refused-write sign-in survival, the empty-discovery skip, the discovery-refused skip, and the exact `replace` payload with revision.
