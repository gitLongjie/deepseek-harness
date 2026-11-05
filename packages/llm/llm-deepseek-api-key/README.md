---
description: "DeepSeek API-key authentication and model discovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek-api-key

English | [中文](README.zh.md)

## Summary

Register authentication and model discovery for `deepseek-official`. This plugin shares the [Messages transport](../llm-deepseek/README.md) and owns credential resolution and catalog availability. It does not request a model listing.

Authentication resolution returns the validated API key in `x-api-key` for both Messages and Files requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

`apiKeyEnv` defaults to `DEEPSEEK_API_KEY` and resolves per request and model discovery. When the credentials service exists, its precedence applies; only compositions without that service read the launch environment directly. Requests with missing credentials fail with `MISSING_CREDENTIAL`; malformed credentials fail with `INVALID_CREDENTIAL`. Model discovery returns an empty catalog when the credential is missing, hiding the route from model selectors while retaining its settings entry. Malformed credentials and other lookup failures propagate. Adding or removing a key affects the next discovery call.

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    reasoningEffort: high
    apiKeyEnv: DEEPSEEK_API_KEY
```

The endpoint and credential reference come from one configuration resolution. In-flight requests retain that snapshot; subsequent updates affect subsequent calls. Account login state cannot change this route’s credential.

`models` is this provider's catalog. Defaults and protocol capabilities come from the shared transport. The route serves that catalog and does not request `GET /models`, on `https://api.deepseek.com` or any other endpoint. Discovery does not probe inference endpoints. `modelsTimeoutMs` and `modelsMaxAgeMs` remain accepted so existing configuration loads; they do not send a listing request.

| Field | Default | Meaning |
|---|---|---|
| `modelsTimeoutMs` | `5,000` | Accepted; this route does not send a listing request |
| `modelsMaxAgeMs` | `600,000` | Accepted; this route does not send a listing request |

The settings namespace is the Cordis entry id, or the plugin name without an entry. Product profiles retain the official entry id `llm-deepseek` and use `llm-deepseek-account` for the account route.

<a id="understand-the-implementation"></a>
## Understand the implementation

Registrations dispose with the plugin. Shared Host wiring supplies attachments, request extensions, anonymous identity, and atomic retry-policy updates; this plugin registers only its own route. Model discovery reads the configured catalog after the API key resolves and does not call the listing cache.

<a id="further-exploration"></a>
## Further Exploration

[LLM streaming](../../../docs/subsystems/llm-streaming.md) · [Messages](../llm-deepseek/README.md) · [No API-key listing request](../../../.agents/notes/implemented/simplification/2026-11-04-api-key-route-skips-model-listing.md)

<a id="model-experience"></a>
## Model Experience

### Authenticated model requests

#### What the model sees

Requests on `deepseek-official` add no model-visible text from this plugin; the shared Messages transport serializes requests.

#### Token effect

Authentication and discovery add no input tokens. Each model's context window and default output cap come from the configured catalog, which each request's logged context and header record.

#### KV Cache effect

Credentials and catalog availability do not enter model input; the protocol transport owns request-prefix serialization. A catalog change to a model's system prompt or tool update mode changes how later system prompt or tool updates are serialized.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A configured catalog is configuration metadata, not remote validation that a model is accepted; actual calls can still fail.
- Models the service adds later stay out of this route until a release updates the built-in catalog or the deployment sets `models`.

<a id="dev-note"></a>
### Dev Note

Registration and authentication tests also cover the Loader composition in the shared transport package.
