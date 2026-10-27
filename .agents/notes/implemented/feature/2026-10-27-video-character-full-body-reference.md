# Agent Note: Character assets anchor on a full-body reference and document a turnaround sheet

Status: implemented

English | [中文](2026-10-27-video-character-full-body-reference.zh.md)

## Problem

Character asset generation produced a half-body portrait and a separate front/side/back sheet. The two images could disagree about clothing, shoes, and body proportions, while later shots used the portrait as the subject reference and left the sheet as a competing visual record.

Dropping the sheet removed that conflict but also removed the record: a single front-facing image says nothing verifiable about the side silhouette, the back of the hair, or how the shoes read from behind, so a wardrobe mistake only appeared after a full clip had been rendered.

## Decision

`video_asset_images` generates one 3:4 image per character as the anchor. The prompt requires one centered standing person with the complete head-to-shoes figure visible, including hands, clothing, shoes, accessories, and body proportions, and excludes half-body crops, turnarounds, collages, text, and watermarks. That `reference` conditions keyframes and clips.

It then draws a front/side/back turnaround `sheet` from that same reference, passed as the image request's subject: the three views are edits of the anchored person, so they cannot invent a different coat, hairline, or build. The sheet is saved on the plan and in the project library, shown to the user, and never conditions a keyframe or clip — one picture anchors, the other documents.

A character that carries a reference but no sheet is selected by an ordinary call, so a plan made before sheets existed gains one without its reference being redrawn. `regenerate` replaces the reference and the sheet together. A sheet failure does not fail the asset: the reference and any earlier sheet stay recorded, the notice names the failure, and the still-missing sheet keeps the character eligible for a retry. A reference this host cannot read as a file — a URL, or a path that moved — keeps anchoring generation and simply skips the in-conversation copy, whose envelope falls back to the path.

## Alternatives considered

**Keep both images and tell later prompts which one wins.** This leaves two competing depictions available to the workbench and model context, so clothing and proportion drift can still enter through the sheet.

**Generate a three-view sheet as the sole anchor.** A wide multi-person layout is poorly suited to subject-reference conditioning and does not provide one clean full-body image for each shot.

**Ship no sheet at all.** The reference would be the only record, leaving the side and back of the design unverified until a clip exists.

**Automatically regenerate every old character on the next ordinary call.** This would incur image-generation work without an explicit user request. Only the missing sheet is backfilled; reference migration stays attached to `regenerate`.

## Consequences

Each new character costs two image requests: the anchor, then the sheet drawn from it. The reference remains the single conditioning image, so separately rendered shots inherit one look. The prompt and structural tests prove request counts, ratios, sheet conditioning on the reference, backfill, failure isolation, and cleanup; actual visual quality still requires a provider run and human review.

The director agent authors each character's canonical visual prompt before asset generation. It derives observable identity facts and negative constraints from the story and supplied references, stores them in `asset.prompt`, and checks generated images against those facts. Users provide story and character information without hand-writing image prompts; existing references preserve stable identity traits while the generated full-body image supplies the single conditioning anchor.