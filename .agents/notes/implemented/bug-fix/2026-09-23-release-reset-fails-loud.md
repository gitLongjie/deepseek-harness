# Agent Note: The desktop release reset verifies the delete and the create

Status: implemented

English | [中文](2026-09-23-release-reset-fails-loud.zh.md)

## Problem

Re-publishing desktop v1.2.9 — force-pushing the tag onto a commit carrying one more fix — silently kept the first build's installers. The `Desktop publish` run reported success end to end, but every release asset still carried the first run's `updated_at`, and the download endpoint still served the first build's bytes.

`desktop-publish.yml` splits the reset across two parallel jobs. The `create-release` job deleted and recreated the release, but its script treated every failure as tolerable: the DELETE result was `|| true`d away, and the create POST loop fell out after its attempts without checking that any attempt returned 201. The `build` jobs then ran `electron-builder --publish always`, which resolves the release by tag itself and skips every asset whose name already exists there. A release that survived the delete — GitHub's delete→create eventual consistency makes that a live window — therefore left the previous build's installers in place while every job stayed green.

## Decision

The reset script verifies both ends, and the delete goes by the release's numeric id. After the first fail-loud run, the by-tag lookup kept answering HTTP 200 for a release the by-tag delete had already removed — past the script's whole minute-long polling window — so the by-tag pair cannot distinguish a surviving release from a stale answer. The script resolves the id once, deletes by id, polls that id until it answers 404, and exits 1 if it never does; the create loop requires a 201 and exits 1 when no attempt succeeds. The `build` job gains `needs: create-release`, so an upload can only start against the fresh empty release instead of racing it.

## Consequences

A tag re-push now either replaces the release's assets with the new build or turns the run red at the reset job; a silently stale release is no longer a possible outcome. The delete is ordered before any upload, so electron-builder's skip-existing behavior only ever sees the empty release it is meant to fill.

## Testing

Workflow steps are exercised by the release runs themselves. The v1.2.9 re-push after this change is the acceptance case: the reset job must log `release deleted` and `release created`, and every asset's `updated_at` must move to that run.
