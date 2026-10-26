# Agent Note: Rebrand the sign-in gateway model group and self-heal a stored session's endpoint

Status: implemented

English | [中文](2026-09-26-login-gateway-group-rebrand-and-endpoint-self-heal.zh.md)

Extends [the OEM rebrand note](../feature/2026-09-26-miao-workbench-oem-rebrand.md).

## Problem

After the OEM rebrand, the model surfaces still showed the upstream brand. The login-seeded gateway group registered by `llm-deepseek` carried the provider id `deepagens`, the settings namespace `llm-deepagens`, and the display/provider name `Deepagens` — the names the model selector, the Models settings page, and the persisted `agent-default-model` value all render. Separately, the gateway endpoint itself is not code: a sign-in writes the login origin's `/v1` into the provider settings and `DEEPSEEK_BASE_URL` into the credential layer, so after the deployment's `loginUrl` moved, an already-signed-in client kept showing and requesting the previous address (`https://claw.deepagens.com/v1`) until the user signed out and back in — which the first migration had already proven users hit as a bug.

## Decision

Two halves, both in the same change:

- **The gateway route takes the deployment's brand.** Provider id `miaoworker`, settings namespace `llm-miaoworker`, display and provider name `喵工作台` (`llm-deepseek` registers it; `ui-login` writes it). The rename is the migration: the old namespace's stored endpoint and catalog become unread orphans, the new namespace starts empty and is seeded by the login flow, and a persisted default model pointing at the old provider id fails the "catalog serves the current default" check, so the next catalog sync re-points it.
- **A stored session records the login origin it was issued against.** `LoginSession.authOrigin` is written on sign-in; `load()` compares it with the build's login origin and, on a mismatch (a moved deployment, or a session predating the field), re-seeds in the background: rewrite the credential pair against the current origin, re-run the gateway catalog sync, then record the new origin. Best effort throughout — a rejected credential write leaves the origin unrecorded so the next start retries, and a stored key the new account server refuses only costs one failed discovery before the next sign-in repairs the rest.

## Alternatives considered

**Keep the `deepagens` id and rename only the display name.** Rejected: the id and namespace persist into user settings and logs, so the old brand survives every surface a rename is supposed to cover; and a display-name-only change does nothing for the stale-endpoint half.

**Detect the old upstream address (`claw.deepagens.com`) in stored settings and clear it.** Rejected: that hardcodes one deployment's address into product code. Comparing the recorded origin against the build's login endpoint is deployment-agnostic and also covers a future move of this deployment itself.

**Rely on sign-out/sign-in only.** Rejected: the first loginUrl migration shipped with exactly this instruction and the user reported the stale address again; startup self-heal makes the migration invisible for sessions whose key the new server still accepts.

## Consequences

The old `llm-deepagens` namespace data stays on disk as dead weight — the settings service has no section-uninstall seam, and reading-never is the migration. A session with a mismatched origin performs one extra discovery request per start until the origin matches. A persisted default model naming the retired provider id keeps failing until a catalog sync or a fresh sign-in re-points it; with the gateway unreachable that selection stays broken by design, as it was.

## Verification

`ui-login` and `llm-deepseek` suites (646 tests) pass, including new cases for origin-matched hydration (no refresh), pre-field and foreign-origin sessions (credential rewrite + catalog sync + origin recorded), and a rejected migration credential write (origin left unrecorded). `pnpm run typecheck` passes. Built artifacts: `grep` finds no `claw.deepagens.com` in the ui-login bundle or `apps/web/dist`, the baked login URL is the OEM one, and the `llm-deepseek` bundle carries `喵工作台` and `miaoworker`.
