---
description: "The shipped market provider: configure catalog sources, browse plugins, and install them into a profile through npm-validated pnpm runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-market-local

English | [中文](README.zh.md)

## Summary

`dsh-market-local` implements the market contract on this machine: it reads your configured catalog sources over bounded HTTPS, validates every candidate against the npm registry, and installs the resolved exact version into the managed profile with pnpm. A fresh home starts with the built-in DSH 1024Store source preselected, and you can add standard dsh catalog sources of your own. The `dsh market` CLI and the web settings tab ride on this service; installs behave like `dsh plugin add` and activate on the next host start.

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

Mount the plugin; it registers `ctx.market` with no further wiring. The `profile` field defaults to the launcher's profile fact, so a composition inside `dsh` manages the running profile.

```yaml
- name: '@deepseek-ai/dsh-market-local'
```

### Minimal configuration

| Field | Default | Meaning |
|---|---|---|
| `profile` | launcher profile fact | Profile the market manages |
| `npmRegistryUrl` | `https://registry.npmjs.org` | npm registry base URL used as the install-version authority |
| `requestTimeoutMs` | `15000` | Per-request wall-time bound for catalog and registry fetches (ms) |
| `maxCatalogBytes` | `8388608` | Maximum accepted catalog response size (bytes) |
| `maxCatalogEntries` | `20000` | Maximum normalized entries kept in one source's observed cache |
| `cacheTtlMs` | `600000` | Source cache lifetime (ms) |
| `pnpmTimeoutMs` | `300000` | Maximum pnpm install/uninstall runtime (ms) |
| `maxOutputTailBytes` | `8000` | Maximum captured process-output tail retained for failure diagnostics (bytes) |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-market-local) is the exhaustive source for every accepted field.

### Managing sources

`dsh market sources` lists the registry, `dsh market source-add --kind catalog --url <manifest URL> --name <name>` registers a standard source, `source-select` switches the browse target, and `source-remove` deletes one. The web settings tab selects among existing sources; add and remove run through the CLI.

### What can go wrong

A source whose manifest endpoint leaves its origin, misses `/v1/plugins`, or exceeds the response bounds fails loud with the violated rule. An install whose npm validation fails returns a failure outcome naming the unmet requirement, and a pnpm failure carries the captured output tail.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider owns four moving parts. The source registry reads and writes `<dsh home>/market/sources.json` per operation (directory `0700`, file `0600`), so every surface sees one state. Catalog reads follow the source kind: a `catalog` source's manifest pins its endpoint on the manifest origin ending in `/v1/plugins` and declares its supported query parameters and page limits, and one browse is one bounded server-side page call; a `store-v1` source fetches its whole installable list once per cache lifetime and filters, paginates, and searches client-side. Both transports normalize provider payloads through the same zod schemas, drop or repair entries with missing names, reject control and bidirectional-override characters, and cap the observed cache at `maxCatalogEntries` with a `cacheTtlMs` lifetime. Installability resolves the npm registry `latest` manifest and requires the same package name, an exact stable version, and a `dsh.bundle` declaration; install then runs pnpm with that exact version and reconciles `dsh.profile.bundles`, while uninstall revalidates the echoed bundle id against the live manifest first. A timed-out pnpm child owns the failure verdict even when it later reports a zero exit code.

| File | Owns |
|---|---|
| `src/index.ts` | The service: config resolution, source-registry operations, the install chain |
| `src/sources.ts` | The `sources.json` read/mutate/persist cycle |
| `src/catalog.ts` | Manifest discovery, page fetches, client-side filtering, the observed-entry cache |
| `src/http.ts` | The bounded HTTPS transport: size cap, timeout, one redirect |
| `src/npm-registry.ts` | Registry `latest` reads and exact-stable validation |
| `src/profile-io.ts` | Profile manifest reads, pnpm install/uninstall runs, bundle reconcile, the installed view |
| `src/schemas.ts` | Provider payload validation, normalization, and the sources-file schema |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin market subsystem](../../../docs/subsystems/market.md) — the market types and `ctx.market` API.
- [`dsh-market`](../market/README.md) — the contract this package implements.
- [`dsh-market-gateway`](../market-gateway/README.md) — the wire projection for web clients.
- [Profiles and patch layers](../../../docs/architecture.md) — what the profile pnpm runs mutate.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the CLI, gateway, and web consumers, which own every model-facing or user-facing projection of catalog and install state.

#### KV Cache effect

No direct effect; the provider registers no prompt, tool schema, or event payload of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints are current provider boundaries, not a task backlog.

- **DNS resolves before TLS pins nothing** — catalog and registry fetches validate the URL and cap size, time, and redirects, but do not pin resolved addresses; deployments needing network egress control must enforce it below the process.
- **Web source management selects only** — the settings tab switches among registered sources; adding, removing, and naming sources run through the CLI.
- **Installs wait for the next host start** — a fresh bundle layer activates on restart; `restartRequired` reports exactly that and there is no in-session reload.
- **store-v1 filtering happens after the fetch** — the whole installable list must fit `maxCatalogBytes`; a larger upstream list fails rather than truncating.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
