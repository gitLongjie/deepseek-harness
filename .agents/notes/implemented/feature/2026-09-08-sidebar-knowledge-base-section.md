# Agent Note: Sidebar knowledge-base section

Status: implemented

English | [中文](2026-09-08-sidebar-knowledge-base-section.zh.md)

## Problem

The harness had no way to name what an enterprise knowledge deployment exposes. The separately mounted `dsh-weknora` plugin gives the model retrieval tools, but a web client could not list the knowledge bases, and the sidebar's browsing region was a single `sidebar.workspaces` occupant with a standalone New Session pill, leaving no place for a second browsing section.

## Decision

The knowledge-base capability becomes a three-role seam mirroring the market family: `dsh-kb` declares `ctx.knowledgeBase` (listing plus the deployment console URL), `dsh-kb-weknora` implements it over one bounded `GET /knowledge-bases` per read with per-operation credential resolution, and `dsh-kb-gateway` projects it onto the `knowledgeBase` Remote namespace. The sidebar shell declares a `sidebar.knowledge` hole above the workspace region, and the new `dsh-client-ui-knowledge-base` browser plugin fills it: a foldable section with inline search, the deployment console action, and one row per base that starts a New Session. The New Session control drops its elevated-pill styling for a flat list row while keeping its pinned position and rail icon, so the highest-frequency action never scrolls away.

The WeKnora base URL is deployment-owned intranet configuration, so the provider deliberately runs no public-address guard — the market transport's HTTPS-only public-host rules do not apply. Enterprise visibility stays on the knowledge service: the listed bases are exactly what the configured credential can read. Retrieval is deferred: the seam carries listing only until a consumer needs search or read on it, and row clicks start plain sessions until per-session agent presets scope the knowledge tools.

## Alternatives considered

**Render the section inside ui-workspace's browser.** Rejected because knowledge bases are not workspace-domain state; the shell already owns the sidebar subtree, so a sibling declared hole keeps domain ownership clean.

**Serve the listing from the client directly against WeKnora.** Rejected because the API key would reach the browser and the host's trust fence exists precisely to keep deployment credentials server-side.

**Auto-inject retrieved content into every request.** Rejected as model-visible context: it would require a new `SessionEventMap` member to satisfy model-visible-means-logged, and a model-invoked tool flow answers the same need without that cost.

## Consequences

Deployments get the knowledge section by default in the web bundle; removing the three bundle rows turns the surface off, and a failed listing degrades to a retry row rather than a broken region. Contract drift between the provider and WeKnora's Go types fails loudly (non-array listing, id-less base) instead of silently emptying the sidebar. Session tool scoping per picked base, and retrieval verbs on the seam, remain future work.

## Verification

`dsh-kb` tests cover the Service Definition registration; `dsh-kb-weknora` tests cover load-time config failures, request shape and headers, per-operation credential resolution, and every transport/contract failure arm; `dsh-kb-gateway` tests cover the wire projection; `ui-knowledge-base` tests cover the section states, fold persistence, search, rail, and the browser plugin registration. Sidebar shell snapshots were refreshed for the new slot anchor and the restyled New Session row.
