# Agent Note: The desktop installer ships the business-entry sidebar plugin

Status: implemented

English | [中文](2026-09-12-desktop-ships-business-entry-plugin.zh.md)

## Problem

The `sidebar.business` seat shipped in the client bundle, but its occupant — the `@xmanrui/dsh-business-entry` plugin — only reached developer machines through `dev.ts`, which copies a locally built copy into that machine's `~/.dsh` profile. Every installer therefore rendered the sidebar with the business group silently absent, and nothing in the packaging path could tell the difference between "the deployment ships no business entries" and "the wiring forgot to stage the plugin".

## Decision

The installer stages the plugin exactly like dsh-im. `business-entry` joins the pnpm workspace (its esbuild devDependency installs with the root lockfile; the stray npm `package-lock.json` is gone), `deploy-app.mjs` builds it through that workspace install and stages `lib/`, `package.json`, and `cordis.patch.yml` into `dist/business-entry-package`, and the builder config copies the staged package into `app.asar/node_modules/@xmanrui/dsh-business-entry`. At boot, `resolveOptionalBundlePatch` probes the installation anchor for the package and, when it resolves and declares `dsh.bundle.patch`, injects its patch list as a boot overlay — no profile manifest edit needed. The injected rows are defaults: when any bundle, profile, or home patch row already configures a plugin id the bundle would insert, the injection returns `undefined`, because a second insert of the same id kills the loader with a duplicate-id error and the v1.2.1 build shipped exactly that crash to machines carrying the dev-era profile registration. Absence is the optional case and returns `undefined`; a package that resolves but fails to parse fails boot loudly, like every other patch layer.

## Alternatives considered

**Keep deploying the plugin into the user's home profile.** Rejected: the home profile is per-machine user state; the sidebar group would vanish on every fresh install and reappear only after a manual copy, which is the gap this closes.

**Fold the plugin into a workspace client package.** Rejected: the deployment owns its entry catalog and rebuilds it independently; workspace membership would couple its release cadence to the harness while the standalone-package discipline (own build, own manifest) is what lets it change without a harness release.

## Verification

`apps/desktop/tests/boot.spec.ts` drives `resolveOptionalBundlePatch` against a temp anchor: an installed bundle with a declared patch loads its insert row, an absent bundle returns `undefined`, an installed bundle without a patch declaration returns `undefined`, and a broken patch layer throws. The packaged smoke boots the real artifact, so the staged plugin either mounts or fails the gate.

## Consequences

Installers carry the business-entry group from v1.2.1 on, and the home-profile copy becomes a dev-only concern. The probe reads the app anchor through `createRequire`, so it works identically over source and app.asar layouts. A future second optional bundle rides the same helper; the business-entry call site stays a one-line injection. Removing the plugin from a future installer is back to deleting the stage-and-ship rows, and the boot probe degrades to `undefined` with no composition change.
