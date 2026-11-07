---
description: "The model-facing generate_image tool: how a chat model turns a text prompt into an image the user sees, through the ctx.image service and the durable attachment store."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image

English | [中文](README.zh.md)

## Summary

This package registers `generate_image`, which lets the chat model create one image from a text description. The image is generated through [`@deepseek-ai/dsh-image`](../image/README.md), stored as a durable attachment, and returned beside a short text envelope, so the user sees it in the tool call and the model can inspect what it made. Choose it when a conversational model such as DeepSeek should produce pictures on request.

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

Load this package with `@deepseek-ai/dsh-image`, at least one usable image provider, and an attachment store. The shipped base composition mounts the service, this tool, and `attachment-local`; the Web `standard` preset adds the tool to each agent. The shipped composition seeds `imageModel: gpt-image-2` on `llm-deepagens`, so the `deepagens` provider is usable without a settings edit.

### When to choose it

Choose it when the model should create images inside the conversation. The calling model must declare image input, because the generated image enters history as an image block; the tool refuses before generation on a text-only route. To use an image model as the conversation model itself, configure it as an `endpoint: image-generation` catalog model on `llm-deepagens` instead.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-image'
- name: '@deepseek-ai/dsh-tool-image'
  config:
    timeoutMs: 180000
```

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `180000` | Cooperative timeout budget (ms) for one call, enforced by the tool-call timeout policy |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-image) is the exhaustive source for every accepted field.

### What the model can do

- **`generate_image(prompt)`** — generate one image from a complete visual description and show it to the user. Each call produces a new image; to change a result, the model calls again with a revised prompt.

### What success and failure look like

A successful call returns the text envelope and the image; the Web tool row shows the image in its gallery. Failures are tool errors with an actionable reason: a blank prompt, a calling model without image input, no usable image provider (`IMAGE_PROVIDER_UNAVAILABLE` until an image model is configured), a backend rejection carrying the provider's message, or an attachment-store refusal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Refuse before spending.** The image-input route check runs before the backend call, so a text-only route never pays for an image it cannot keep in history.
- **One durable record.** The image is committed to the attachment store before the result settles; the output value carries the attachment reference, and `render` projects it into the image block.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: configuration, the `generate_image` definition, the route gate, attachment commit, and presentation |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-image](../image/README.md) — the provider-selecting service this tool calls.
- [Image package map](../README.md) — the group and each package's role.
- [`llm-deepagens` configuration](../../llm/llm-deepagens/src/config.ts) — the shipped `deepagens` image provider and its `imageModel` setting.
- [Adding a tool](../../../docs/cookbook/adding-a-tool.md) — the tool definition and presentation rules this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### Model-facing contract

#### What the model sees

One tool, `generate_image`, with a single required `prompt` parameter. A result is a text envelope naming the media type, pixel size, byte count, and backend model, followed by the image itself. Failures are model-safe reasons, never stack traces.

#### Token effect

The tool definition adds a short description and one parameter to every request where the tool is offered. Each call adds the envelope and one image to history; the image costs input tokens on later requests like any other image block.

#### KV Cache effect

The package adds no system-prompt text; tool calls and results append after the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Text prompts only.** Size, quality, and editing a previous image with reference images are not exposed.
- **No workspace file.** The image lives in the attachment store; the model cannot pass a workspace path for it to other tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests drive the real tool pipeline, `ctx.image`, and the local attachment store with a scripted provider and catalog adapter.

</details>
