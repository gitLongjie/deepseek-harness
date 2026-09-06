---
description: "The web settings marketplace tab: browse catalog sources, inspect installability, and install or uninstall plugins from the browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-market

English | [中文](README.zh.md)

## Summary

This package adds the marketplace tab to the web client's Plugins settings: it lists the configured catalog sources, browses the selected source's entries with search, shows each entry's npm-validated installability, and installs or uninstalls plugins in the managed profile. Installs and uninstalls run on the host and take effect on the next host start; the tab reports `restartRequired` instead of pretending to hot-reload. Source management selects among existing sources; adding and removing sources runs through the `dsh market` CLI.

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

The web-app bundle mounts this package by default, and the tab appears under Plugins in settings. A host without a market provider leaves every view reporting its read failure rather than hiding the tab.

### Minimal configuration

No config. The tab reads the `market` Remote namespace and the shared settings and locale services.

### What can go wrong

A failed read keeps the tab usable: the failing view shows its error and a retry control. An install whose host-side npm validation fails surfaces the failure message and the captured output tail.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The host half is an empty `apply`; the browser half registers a `settings.plugins.tab` slot component. The component holds three views — discover (search plus entry detail with installability and install), installed (the profile view with uninstall), and sources (list and select) — each loading on activation through the injected Remote face and reporting success or failure notes above the lists. All copy routes through the typed `settings.market` locale dictionary.

| File | Owns |
|---|---|
| `src/index.ts` | The host loader entry |
| `src/client/index.ts` | The `dsh.client` registration and Remote face binding |
| `src/client/MarketSettingsTab.tsx` | The discover, installed, and sources views |
| `src/client/locales.ts` | The `settings.market` locale dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin market subsystem](../../../docs/subsystems/market.md) — the market types behind the tab.
- [`dsh-market-gateway`](../../market/market-gateway/README.md) — the Remote namespace this tab calls.
- [Slots reference](../../../docs/subsystems/slots.md) — how the settings tab composition works.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the host-side market service the tab calls, which owns every model-facing effect.

#### KV Cache effect

No direct invalidation; the tab performs no model request of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Source management selects only** — the sources view lists and switches the selection; adding, removing, and naming sources run through the CLI.
- **No live install progress** — install and uninstall are single request/response operations; long pnpm runs stay bounded by the host's `pnpmTimeoutMs` and surface only as a settled outcome.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
