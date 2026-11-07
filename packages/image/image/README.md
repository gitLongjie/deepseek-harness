---
description: "The image-generation service (ctx.image): how deployments and plugin authors generate images through interchangeable providers, with one selection policy and error vocabulary."
kind: "package-reference"
---

# @deepseek-ai/dsh-image

English | [中文](README.zh.md)

## Summary

Use `dsh-image` to generate an image from a text prompt without tying callers to a specific backend. It selects one usable provider for each request and gives callers consistent cancellation and structured errors. Choose it for plugins or tools that call `ctx.image.generate()`; the shipped `dsh-tool-image` tool loads it for you. Generation requires a registered, usable provider because this package makes no network requests on its own.

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

A composition that needs image generation loads the `dsh-image` service and mounts at least one provider; plugin or tool authors then call `ctx.image.generate()`. The service resolves the provider for each call, so callers never see provider ids unless they configured one.

### When to choose it

Choose the service when a plugin or tool must generate images without hard-coding a vendor. A deployment that only uses the shipped `generate_image` tool gets it through the base composition. Without a usable provider, every call fails with a structured `ImageError`.

### Minimal configuration

Load the service and let a single usable provider auto-select, or pin one with `provider`. In the shipped composition, `llm-deepagens` registers the `deepagens` provider and seeds `imageModel: gpt-image-2` so generation works without a settings edit; sign-in replaces that id with the first model the gateway listing tags `image-generation`.

```yaml
- name: '@deepseek-ai/dsh-image'
- name: '@deepseek-ai/dsh-llm-deepagens'
  config:
    protocol: chat-completions
    baseURL: https://claw.deepagens.com/v1
    imageModel: gpt-image-2
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | (unset) | Pinned provider id; unset auto-selects when exactly one is usable |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-image) is the exhaustive source for every accepted field.

### Generating an image

`generate()` sends one prompt to the selected provider and resolves with the encoded bytes, their media type, and the backend model when the provider reports it. The optional `AbortSignal` is forwarded to the provider.

```text
const image = await ctx.image.generate({ prompt: 'a quiet bay at dawn' }, signal)
// image.data: Uint8Array, image.mediaType: 'image/png', image.model: 'gpt-image-2'
```

### Provider selection

Each call resolves its provider at execution time; registration and load order never matter.

| Situation | Outcome |
|---|---|
| configured id registered and usable | runs that provider |
| configured id not registered | `IMAGE_PROVIDER_CONFIGURED_MISSING` |
| configured id registered but unavailable | `IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE` |
| no id, exactly one usable provider | runs it |
| no id, no usable provider | `IMAGE_PROVIDER_UNAVAILABLE` |
| no id, several usable providers | `IMAGE_PROVIDER_AMBIGUOUS` |

A provider's `available()` is a cheap local check, such as whether a model is configured, and never makes network calls.

### Failures and recovery

Selection failures throw `ImageError` with one of the codes above; a duplicate provider id throws `IMAGE_DUPLICATE_PROVIDER` at registration. Provider failures, such as an HTTP rejection from the backend, propagate unchanged with the provider's own error code. To change which backend runs, pin `provider`, mount or unmount providers, or fix the provider's configuration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Selection is never order-dependent.** The service either runs the pinned provider or the single usable one, resolved when `generate()` is called.
- **Bytes, not attachments.** The seam returns encoded bytes so each consumer decides how to persist them; `dsh-tool-image` commits them to the attachment store.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `ImageRuntime` service, the provider registry, and execution-time selection |
| [`src/types.ts`](src/types.ts) | Vocabulary: request and result types, the provider protocol, and the `ImageError` taxonomy |

### Registration

Providers register through an effect on the calling fiber and unregister when it disposes, so a hot-reloaded provider plugin never leaves a stale entry.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Image package map](../README.md) — the group and each package's role.
- [dsh-tool-image](../tool-image/README.md) — the model-facing `generate_image` tool over this service.
- [`llm-deepagens` configuration](../../llm/llm-deepagens/src/config.ts) — the shipped `deepagens` provider and its `imageModel` setting.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — the selection rules this seam follows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-image`, which renders generated images to the model; this service contributes no prompt or schema.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Requests carry only `prompt`.** Size, quality, count, and reference images for editing are deferred until a consumer needs them and the backends can honor them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The H3 video image backends (MiniMax and ComfyUI) predate this seam and still run through `ctx.h3Video`; registering them as `ctx.image` providers is open work.

</details>
