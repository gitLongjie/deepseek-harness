# Agent Note: Promote the video packages into a product-role group

Status: implemented

English | [中文](2026-10-07-video-packages-promoted-to-product.zh.md)

## Problem

The H3 video capability shipped as three `packages/experimental/` packages while the shipped desktop and Web compositions depended on all three. The [default-product isolation gate](../../../../scripts/verify-default-product-isolation.ts) rejects exactly that: experimental packages may not appear in a default product's dependencies, runtime imports, or shipped compositions. The gate reported nine video violations — two `apps/desktop` dependency rows, two `packages/bundle/web-app` rows, and two bundle-patch rows, across `h3-video`, `tool-video`, and `video-workbench` — so the desktop build was permanently red for a capability it deliberately ships.

The [experimental subtree rules](../../../../packages/experimental/AGENTS.md) name the sanctioned resolution: a package that a release product needs is promoted into a product-role group and drops the `experimental-` npm prefix.

## Decision

The three packages move to a new `packages/video/` group and drop the prefix:

| Before | After |
|---|---|
| `packages/experimental/h3-video` — `@deepseek-ai/dsh-experimental-h3-video` | `packages/video/h3-video` — `@deepseek-ai/dsh-h3-video` |
| `packages/experimental/tool-video` — `@deepseek-ai/dsh-experimental-tool-video` | `packages/video/tool-video` — `@deepseek-ai/dsh-tool-video` |
| `packages/experimental/video-workbench` — `@deepseek-ai/dsh-experimental-video-workbench` | `packages/video/video-workbench` — `@deepseek-ai/dsh-video-workbench` |

The `./settings` subpath keeps its shape as `@deepseek-ai/dsh-h3-video/settings`. The browser half stays where it already was, `packages/client/ui-video-workbench` (it never carried the experimental prefix, because the isolation gate only rejects the prefix). Every import, `tsconfig` path and project reference, bundle patch row, and dependency row moves with them in one change, so no intermediate state resolves a half-renamed package.

Promotion makes the group's rules the product rules. Four obligations that experimental status had waived now hold and are satisfied here:

- **Complete service JSDoc.** The Cordis catalog requires `@param`/`@returns` on every documented service method; `h3Video.capabilities`, `canServe`, `poll`, `assemble`, and `h3VideoSettings.get` gained the missing tags.
- **A boot-manifest row.** `gen-tool-catalog` globs `packages/*/tool-*` and fails on any tool package it cannot catalogue; `tool-video` was never listed, so the generator had been failing since that package landed. It now has a `TOOL_PACKAGES` entry that mounts the seam with a placeholder local backend, because schema harvest never submits a render.
- **Type-link classification.** Each service-signature type is classified for the Cordis catalog; the ten video types are exempted to the `h3-video` package README, the same non-catalog owner shape the policy already uses for other service packages.
- **A stated invariant posture.** Both workbench READMEs carry the `No … companion is published` reason sentence the invariant gate requires of a package that omits the companion.

The group has no `docs/subsystems/` page. It carries a justified [`GROUPS_WITHOUT_SUBSYSTEM_PAGE`](../../../../scripts/verify-subsystem-pages.ts) exemption instead: the `ctx.h3Video` contract — configuration, routing, provider capabilities — is documented in the `h3-video` package README, and no type's home is outside that package. A subsystem reference is deferred until a type needs one.

## Alternatives considered

**Keep the packages experimental and remove them from the default product.** This would satisfy the gate by deleting the capability from the shipped desktop and Web compositions, which is the opposite of what those compositions are for.

**Relax the isolation gate for these three packages.** The gate encodes the rule that experimental packages carry no stability promise; an exception would ship a no-promise capability inside the default product and weaken the rule for every future package.

**Move the packages into an existing product group instead of creating `video/`.** `tool-video` could sit with the other model-facing tool packages, but the seam, its consumer, and the workbench project are one capability family that shares an output directory and a lifecycle; splitting them across groups would scatter one contract. A new group costs one README pair and one table row.

**Create `docs/subsystems/video.md` now.** Deferred, not rejected: the seam's contract is currently fully stated in its package README, and a subsystem page would restate it before any type needs a home outside that package. The group README's Dev Note records the deferral.

## Consequences

- The default-product isolation gate loses all nine video violations and reports only the pre-existing `webworker-runtime` row.
- The packages now carry stable-API expectations. Per the [promotion rules](../../../../packages/experimental/AGENTS.md), that review includes a **named owner accepting stable-package obligations**; this change performs the mechanical promotion and does not itself name that owner.
- The group README, its Chinese pair, and a `video/` row in the packages table are new; the experimental group README never listed these three, so it needs no removal.
- Generated artifacts follow the rename: the config catalog, dependency catalog, module graph, and tool catalog were regenerated, and the root `node_modules` plugin links were repointed at the new directories.
