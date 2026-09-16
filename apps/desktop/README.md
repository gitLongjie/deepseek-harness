# MeowWork Desktop Shell

English | [中文](README.zh.md)

The Electron desktop shell that packages the harness into an installable
product: it boots a bundled `dsh` runtime, renders the web client, and adds
the desktop-only integrations a browser cannot own.

## What the shell provides

- **Window, tray, and single-instance lifecycle** — one resident application
  instance, platform-correct title-bar chrome, and a tray control for
  restore and quit.
- **Auto-update** — signed release feeds through `electron-updater`, with
  periodic re-checks while the app runs.
- **Desktop bridges** — completion notifications, an open-session bridge
  into the web client, plugin enable/disable over the home patch layer, and
  knowledge-base connection management from the OEM configuration.
- **OEM configuration** — brand name, brand mark, greetings, titles, and
  knowledge-base connection facts resolve from a deployable OEM config file
  and the trusted environment layer, so one code line ships many brands.
- **Packaged plugin closure** — the installer ships the market, knowledge,
  and business-entry plugin packages beside the app, and the bare-module
  resolution base points at the installed host.

## Development

```sh
pnpm run dev:desktop
```

The dev script assembles the client bundles, prepares the runtime closure,
and launches Electron against the repository sources. Packaged smoke and
release builds live in `scripts/` and run through the release workflows.
