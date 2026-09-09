---
description: "The WeKnora knowledge-base Service Provider: lists the bases a self-hosted deployment exposes to the configured credential through one bounded request per read."
kind: "package-reference"
---

# @deepseek-ai/dsh-kb-weknora

English | [中文](README.zh.md)

## Summary

`dsh-kb-weknora` mounts `ctx.knowledgeBase` over a self-hosted WeKnora deployment: one `GET /knowledge-bases` per read, with a wall-time bound, a body-size bound, and a per-operation credential resolution, so a rotated key reaches the next call without a restart. The base URL is deployment-owned configuration and is commonly intranet, so unlike the market transport this provider runs no public-address guard — the configured URL is the trust decision. The sidebar knowledge section is the consumer, through the wire gateway.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin on a host whose web clients should see the deployment's knowledge bases; it registers `ctx.knowledgeBase`.

```yaml
- id: kb-weknora
  name: '@deepseek-ai/dsh-kb-weknora'
  config:
    baseUrl: http://weknora.internal:8080/api/v1
```

### Minimal configuration

Every connection field absent from yml resolves through the trusted environment layer before its built-in default: `baseUrl` falls back to `$WEKNORA_BASE_URL` (then `http://localhost:8080/api/v1`), the credential reference to `$WEKNORA_API_KEY_ENV` (then `WEKNORA_API_KEY`, resolved per operation through the credentials seam), `tenantId` to `$WEKNORA_TENANT_ID`, and `webUiUrl` to `$WEKNORA_WEB_UI_URL`. The desktop launcher injects the OEM file's `knowledgeBase` section as exactly these names, so a packaged deployment configures the connection in `oem.config.json`. Set `apiKeyEnv: ''` to declare an unauthenticated deployment.

### What can go wrong

Invalid configuration — a non-http(s) `baseUrl` or `webUiUrl`, a reference outside the credential grammar — fails at plugin load. Runtime failures (deployment down, HTTP error, contract-violating payload) surface as `WeknoraKnowledgeBaseError` through the gateway and render as the client section's retry state; error messages never carry the credential.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider extends the `KnowledgeBase` Service Definition and resolves the credential per call. Response payloads are deployment-controlled but contract-checked: a non-array listing or a base without an id throws rather than silently emptying the list; a missing display name falls back to the id.

| File | Owns |
|---|---|
| `src/index.ts` | The `WeknoraKnowledgeBase` provider: config, bounded transport, envelope contract |
| `src/invariant.ts` | The package invariant companion |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge-base subsystem](../../../docs/subsystems/knowledge-base.md) — the listing types and `ctx.knowledgeBase` API.
- [`dsh-kb`](../kb/README.md) — the contract this provider mounts.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the clients the listing serves; the provider registers no prompt, tool schema, or event payload of its own.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Listing only** — the provider reads the deployment's base list; retrieval stays with the model-facing `dsh-weknora` tools until a consumer needs it on this seam.
- **No public-address guard** — the market transport's HTTPS-only public-host rules do not apply here by design; a deployment that wants them must own that policy at its edge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
