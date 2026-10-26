# Agent Note: The desktop Help menu carries contact QR and documentation links

Status: implemented

English | [中文](2026-10-26-desktop-help-menu-contact-and-docs.zh.md)

## Problem

The OEM desktop shell's Help menu offered repository links, feedback, an update check, and About. End users of a branded deployment had no in-app route to the operating team or the product's own documentation: the GitHub repository and its issue tracker are maintainer surfaces, not support surfaces. A consumer product needs "who do I talk to" and "where is the manual" next to the existing entries.

## Decision

- **联系我们 (Contact Us)** is the first Help entry. It opens a small modal window over the focused window showing the bundled `apps/desktop/build/contact-qr.png` at 320px, with a scan hint and a close button; Escape and the button close it. The image rides electron-builder's existing `build/**` file glob into app.asar, so a deployment swaps that one file to change the QR.
- **帮助文档 (Documentation)** follows it and opens `helpDocsUrl` through `shell.openExternal`. The URL is an OEM deployment fact: optional, HTTPS-only `oem.config.json.helpDocsUrl` is baked into `extraMetadata.dsh.helpDocsUrl` at packaging time; a source run reads the repository file and an installed app reads the manifest, mirroring the update feed, knowledge base, and gateway display name.
- **Absent configuration omits the entry.** A deployment without `helpDocsUrl` drops the documentation item rather than rendering a dead link, the same rule the update entry uses. The contact entry always exists because the shell ships its image.
- **Copy is locale-owned.** Both labels and the popup strings live in `desktop/locales.ts` (联系我们 / 帮助文档 and their English counterparts), so the existing locale rebuild refreshes them.

## Alternatives considered

- **`dialog.showMessageBox` with the QR as its icon.** Rejected: the native message box scales the icon small enough that scanning from a screen is unreliable.
- **Generate the QR from a URL at runtime.** Rejected: the contact image is an asset the operating team owns (a WeChat or enterprise contact card), not a URL the shell can encode; a bundled image also renders identically offline.
- **Hardcode the documentation URL in `menu.ts`.** Rejected: documentation destinations are deployment facts like the update feed. The OEM file already carries those, and bake-or-omit behavior prevents shipping a wrong link.
- **Render the QR inside the web client.** Rejected: the Help menu belongs to the Electron main process and the title bar's native-popup path; adding a client slot would couple one menu action to the web plugin graph.

## Consequences

- The shipped `oem.config.json` points `helpDocsUrl` at [the company support page](https://www.deepagens.com/faq); a deployment with its own manual changes that one field, and packaging bakes it into the manifest.
- Contact and documentation are one click away for end users, while the repository, feedback, update, and About entries stay for maintainers.
- Changing the contact QR means replacing `apps/desktop/build/contact-qr.png`. A missing file reports a localized error dialog instead of opening an empty window, and a load failure destroys the popup before reporting.
- The shipped `apps/desktop/build/contact-qr.png` is the company's official contact QR — the 深度云海 public-account card published on deepagens.com. Swapping it for a different support card means replacing that one file; the popup itself needs no change.
- `apps/desktop/tests/{menu,contact-qr,help-links}.spec.ts` pin the menu entries, the popup document, and the source/manifest resolution; `scripts/oem-config.client.spec.ts` and `apps/desktop/tests/builder-identity.spec.ts` pin the OEM validation and packaging projection.

## References

- Desktop surfaces: `apps/desktop/src/main/desktop/{menu,contact-qr,help-links,locales}.ts`, `apps/desktop/src/main/index.ts`
- OEM configuration: `oem.config.json`, `scripts/oem-config.ts`, `apps/desktop/scripts/{desktop-oem-config.mjs,deploy-app.mjs}`
- Bundled asset: `apps/desktop/build/contact-qr.png` (the official contact card at https://www.deepagens.com)
