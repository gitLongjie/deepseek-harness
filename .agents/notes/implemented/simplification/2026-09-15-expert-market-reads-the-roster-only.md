# Agent Note: Expert market reads the deployment roster only

Status: implemented

English | [中文](2026-09-15-expert-market-reads-the-roster-only.zh.md)

## Problem

The expert market (`packages/client/ui-expert`) merged two sources: the deployment's shipped roster rows and a hardcoded curated roster (`mock-data.ts`, thirteen expert cards plus four featured-scenario banners mirroring a reference market). Every page load therefore displayed experts no deployment had shipped — cards for third-party products with no corresponding preset anywhere in the repository — and the merge gave the hardcoded record display priority over a server row sharing its id. The deployment could not curate what the market showed, and an empty deployment still presented a full marketplace.

## Decision

The market's sole source is the deployment's agent-preset roster: rows that publish card metadata (`category` set — the committed expert marker that keeps mode presets out) project onto card records, and every other source is gone. `mock-data.ts` is deleted, including the featured-scenario banners; the banners' section, its `featured.title` locale key, and their CSS rules are removed with them. A refused or absent roster read degrades to an empty market, which renders the existing empty state.

The card record design is unchanged: `subtitle`, `badge`, and `avatar` still render when a record carries them, and a row without them falls back to the deterministic gradient tile and published glyph. The two shipped experts (`geo-optimizer`, `article-publisher`) already publish the full `preset.yml` card design; only the subtitle, badge, and avatar image wait for the roster to carry them, as recorded in the package README's deferred work.

## Alternatives considered

**Keep the curated roster as an empty-roster fallback.** Rejected because an empty market is the honest state for a deployment that shipped no experts, and any surviving fallback resurrects content the deployment cannot inspect or manage — the exact property the removal exists to delete.

**Port the curated cards into shipped `preset.yml` metadata instead of deleting them.** Rejected for the third-party cards: they describe products with no preset in the repository, so porting would fabricate deployable experts. For the two real experts nothing needed porting — their `preset.yml` already publishes the metadata the cards displayed, and the roster reader projects it.

## Verification

`packages/client/ui-expert/tests/apply.client.spec.tsx` admits only shipped rows with card metadata and pins the refused-read degrade to an empty market; `browser.client.spec.tsx` keeps its own fixtures and covers the record design, search, filters, and hire. Package specs pass (12/12), the package typechecks, and oxlint is clean.

## Consequences

The market shows exactly what the deployment ships, and says "no experts" when that is nothing. The curated-roster era's featured-scenario surface is gone outright — section, locale key, and CSS. Cards lose the attribution subtitle, curator badge, and avatar image the hardcoded records carried until the roster carries them through the marketplace install channel; the fields remain in the record contract and render when populated.
