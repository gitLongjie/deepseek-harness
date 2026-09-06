# Agent Note: The plugin market capability

Status: implemented

English | [中文](2026-09-04-plugin-market-capability.zh.md)

## Problem

Installing a plugin required knowing its npm package name and running the CLI by hand. A user browsing the web GUI had no discovery surface: no way to see what plugins exist, what each one installs, or whether a candidate is installable at all. Desktop distributions amplified this — a shipped product needs a curated, searchable catalog rather than package-name folklore.

The install path itself already existed and was trusted: `dsh plugin --profile <name> add` mutates a profile's `dsh.profile.bundles` through the profile package manager with the profile manifest as the only truth. Reusing an untrusted catalog naively would have put provider-controlled names and versions into that command.

## Decision

The market is a capability seam with three roles. `dsh-market` defines the abstract `Market` service on `ctx.market`; `dsh-market-local` implements it; the `dsh market` CLI, the `dsh-market-gateway` Typert remote, and the `ui-settings-market` web tab consume it. Consumers hold no npm knowledge: they submit opaque branded ids, and the service resolves every package name, version, and command itself.

Three boundaries carry the trust model:

- **The npm registry is the sole version authority.** Installability requires exactly one declared npm package whose registry `latest` manifest carries the same name at an exact stable release and declares `dsh.bundle.patch`. A catalog entry's `npmPackage` and `latestVersion` are display claims, never command inputs.
- **Provider payloads are validated, normalized, and capped.** The zod schemas bound response size, entry count, and request time, strip provider payload fields from projected entries, and reject control and bidirectional-override characters before display text reaches a client. The observed-entry cache is the only path to install: an entry a source has not normalized cannot install.
- **Installation runs the existing profile machinery.** The service resolves the exact version, runs pnpm with it in the profile directory, and reconciles `dsh.profile.bundles`, so a market install is indistinguishable from `dsh plugin add` and activates on the next host start. The installed view reads only the profile manifest, so every install route appears in it.

Catalog sources are user-configured records in `<dsh home>/market/sources.json` — an open contract, not a hard-coded store. Two transport kinds ship: `catalog` (the standard dsh catalog endpoint with server-side paging, its manifest pinned to its origin) and `store-v1` (the DSH 1024Store bounded projection, fetched once per cache lifetime and filtered client-side). A fresh home seeds the built-in DSH 1024Store source preselected.

## Alternatives considered

**Trust the catalog's declared version and install it directly.** Rejected: it hands command inputs to untrusted provider content. The registry re-resolution costs one bounded request and closes the gap.

**A dedicated plugin-store server-side component in this repository.** Rejected for now: the source-registry contract makes the client source-agnostic, so any catalog endpoint can serve without a DSH-operated store; the `catalog` kind is that contract's first dialect.

**GUI-managed source editing.** Deferred: source records are few and change rarely, so the CLI owns add/remove/naming and the web tab only selects among them. The gateway and tab stay free of write-side validation work.

## Consequences

`dsh-market-local` owns a bounded HTTPS transport (size cap, timeout, one redirect), a per-source observed-entry cache with a TTL, npm registry reads, and profile pnpm runs. Its config exposes the bounds (`requestTimeoutMs`, `maxCatalogBytes`, `maxCatalogEntries`, `cacheTtlMs`, `pnpmTimeoutMs`, `maxOutputTailBytes`); DNS is resolved below the process and nothing pins resolved addresses, so network egress control stays a deployment concern. `restartRequired` is exact: bundle layers activate on the next host start, and no in-session reload exists.

The Remote gateway registers under its own service key `marketGateway` with the wire namespace `market`, mirroring `settingsController` — a concrete provider registers `ctx.market`, and the two keys must not collide.

## Verification

`packages/market/market-local/tests/` covers the transports, schemas, registry validation, source registry, pnpm runs (including the timed-out-child verdict), and the installed view at 100% branch coverage; `packages/market/market/tests/` and `packages/market/market-gateway/tests/` cover the service registration and the wire projection; `packages/client/ui-settings-market/tests/` covers the tab views. The CLI surface lives in `apps/cli/src/market.ts` with its own tests.
