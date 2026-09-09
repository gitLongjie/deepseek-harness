# Agent Note: OEM-owned knowledge-base connection

Status: implemented

English | [中文](2026-09-10-oem-knowledge-base-connection.zh.md)

## Problem

The knowledge-base connection lived only in the web bundle's patch row (a hardcoded localhost baseUrl) and in hand-exported environment variables. An OEM deployment — the packaged desktop app built from `oem.config.json` — had no place to declare which WeKnora deployment the product talks to.

## Decision

`oem.config.json` gains a validated `knowledgeBase` section (baseUrl, apiKeyEnv, optional tenantId and webUiUrl; the secret itself never enters the file — only the credential-reference name does). The desktop main resolves it from the source-tree `oem.config.json` when present, else from the section the packaging overlay bakes into the application manifest's `extraMetadata.dsh` (the update feed's dual route), and applies it to the environment before the layered snapshot freezes — without replacing values the launching environment already owns. The kb-weknora provider resolves connection fields absent from yml through the trusted environment layer (`$WEKNORA_BASE_URL`, `$WEKNORA_API_KEY_ENV`, `$WEKNORA_TENANT_ID`, `$WEKNORA_WEB_UI_URL`) before its built-in defaults, mirroring llm-deepseek's endpoint fallback; the bundle row stops pinning `baseUrl` so the chain stays live.

Precedence, most trusted first: explicit cordis.yml config, an exported variable, the OEM section, a `.env` layer, the built-in local default.

## Alternatives considered

**Write the section into a profile patch at packaging time.** Rejected: patch rows would need generating and users could not see or override the result; the environment layer already has well-defined precedence and the plugin seam already resolves it.

**Read `oem.config.json` directly in the plugin.** Rejected: the plugin would depend on a repository-root file that does not exist in the packaged layout, and OEM identity would leak below the launcher boundary that owns it.

**Put the API key in the OEM file.** Rejected: the OEM file is committed build input; secrets stay in the credentials seam behind a reference name.

## Consequences

A packaged deployment configures its knowledge-base endpoint purely in `oem.config.json`; source runs may keep using exported variables or `.env`. The client build validates the section, so a malformed one fails the build rather than the booted app.

## Verification

`scripts/oem-config.client.spec.ts` covers section parsing, projection, and rejections. `kb-weknora` provider tests cover the environment fallback chain (environment without config, explicit config above environment, local default below both). The desktop spec covers source-file preference over the manifest, section validation, and apply-if-unset semantics.
