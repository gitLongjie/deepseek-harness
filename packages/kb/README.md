---
description: "The knowledge-base group map: the listing service definition, the WeKnora provider, and the wire and web surfaces — for users and maintainers navigating the group."
kind: "package-group"
---

# kb/ — knowledge-base capability family

English | [中文](README.zh.md)

## Summary

The `kb/` group names what an enterprise knowledge deployment exposes: one provider-neutral listing service (`ctx.knowledgeBase`), the WeKnora backend, and the surfaces that read it. A deployment mounts the WeKnora provider pointed at its own instance, and the host Remote gateway projects the listing for the web client's sidebar knowledge section, so the client-facing surface stays stable while backends come and go. Three packages split the family: the `kb/` service definition, the WeKnora provider, and the wire gateway. The group owns listing only: retrieval verbs join the definition when a consumer needs them, and the model-facing knowledge tools live in the separately mounted `dsh-weknora` plugin.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three packages play the knowledge-base roles.

| Package | Role | ctx key |
|---|---|---|
| [`kb/`](kb/README.md) | Listing Service Definition: the bases a deployment's knowledge service exposes | `ctx.knowledgeBase` |
| [`kb-weknora/`](kb-weknora/README.md) | Lists the bases through a self-hosted WeKnora deployment | registers `ctx.knowledgeBase` |
| [`kb-gateway/`](kb-gateway/README.md) | Projects the listing onto the `knowledgeBase` Remote namespace | registers `ctx.knowledgeBaseGateway` |

The web client's sidebar section lives in [`@deepseek-ai/dsh-client-ui-knowledge-base`](../client/ui-knowledge-base/README.md), outside this group like every browser half.

-----

<a id="related-documentation"></a>
## Related documentation

- [Knowledge-base subsystem](../../docs/subsystems/knowledge-base.md) — the listing types and `ctx.knowledgeBase` API.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
