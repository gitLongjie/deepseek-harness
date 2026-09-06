# Agent Note: Desktop plugin links follow the running installation

Status: implemented

English | [中文](2026-09-04-desktop-plugin-links-follow-running-installation.zh.md)

## Problem

An open (source) desktop boot resolved its plugin packages through two link chains shared with other dsh installations: the repository-root `node_modules/@deepseek-ai` links and the `$DSH_HOME/profiles/node_modules` fallback directory. An installed older desktop release had re-pointed the shared fallback at its own packaged copies, which predate `registerContinuableSetup` in `dsh-subagent`, while `dsh-tool-subagent-report` still resolved into the workspace through an older link generation. The boot mounted a stale `subagents` service beside a fresh consumer, and the loader failed with `ctx.subagents.registerContinuableSetup is not a function`.

Two defects allowed the skew. `ensureRootPluginLinks` created root links once and skipped existing ones, so each link kept following whatever the shared fallback directory held — and that directory is rewritten by whichever dsh installation heals last. `resolveModuleFallbackEntries` also recorded raw resolution paths, so an entry found through a top-level link was written back as the link path itself, producing a self-referential cycle when healed.

## Decision

`resolveModuleFallbackEntries` anchors every open-runtime entry at the physical package directory (`realpathSync.native`, guarded for pkg-snapshot paths), so a healed link names a concrete package instead of riding a link chain. Packaged executables keep the original resolution paths: their module proxies must retain the virtual module URL inside the snapshot.

The desktop's `ensureRootPluginLinks` now derives its links from the running installation's closure (new `resolveInstallationModuleLinks` export of `dsh-app-boot`), points each link in the root scope directory directly at the resolved package directory, and rewrites links whose target differs instead of skipping them. Names outside the running installation's scope keep the shared-directory mirror so profile-scope plugins still resolve. A boot can no longer mix a foreign installation's plugin generation into its tree, and a skewed machine heals on the next launch.

## Alternatives considered

**Drop the repository-root links and resolve plugin packages from the profile directory.** Rejected because the vendored Loader's bare import walks up from `vendor/loader`, not from the profile baseUrl, so without the root links every dsh-owned plugin would fail to resolve in the open runtime.

**Keep mirror links and refresh only their stale targets.** Rejected because the shared fallback directory remains a cross-installation battleground; direct targets are what remove the desktop's dependence on whichever installation healed last.

## Consequences

A source desktop boot rewrites its own root links on every launch, and the shared fallback heals to the running installation's closure, so an older installed release can no longer serve plugin code to a source boot. Link churn is bounded: targets are stable physical paths, so after one heal later launches rewrite nothing. `healProfilesModuleFallback` links now carry realpath'd targets, which changes the on-disk link text once for existing installations.

## Verification

`packages/boot/app-boot/tests/profile.spec.ts` pins physical-target anchoring for a linked bundle dependency and for a dependency found above the installation through a top-level link. `apps/desktop/tests/boot.spec.ts` pins direct closure targets, the stale-link rewrite, and the shared-directory mirror for out-of-closure names. The desktop boot path was exercised against the real tree: the root `dsh-subagent` link resolves to the workspace package, and its built lib carries `registerContinuableSetup`.
