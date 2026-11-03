# Agent Note: Multi-shot story continuity uses one opening frame

Status: implemented

English | [中文](2026-10-26-video-multi-shot-story-continuity.zh.md)

## Problem

The video tools accepted a multi-shot plan, but the renderer previously spread the first shot through a generic segment request. Later shot references, backend choices, and state transitions were therefore either ignored or applied inconsistently. The prompt also described each shot as a separate scene, which encouraged plot resets inside a short film.

## Decision

The director preserves requested duration and shot count, preferring a continuous shot when no cuts are requested and the action permits it. A 15-second story can use one 15-second segment; action beats do not imply cuts. Necessary camera changes use story-driven shot durations in one request. Shot timing belongs to the shared timeline; an individual shot does not require a separate render task. Independent frame targets and routing remain reasons to use `per_segment`.

`multi_shot` sends one H3 request for a complete story of at most 15 seconds. Each shot records its starting state, one observable event, ending state, continuity relation, and explicit asset ids. The plan validator requires these fields for multi-shot stories with more than one shot, checks asset ids, and rejects mixed backends, mixed canvas settings, later-shot references, partial selection, and chaining because those inputs cannot be represented by the one request.

The request uses exactly one confirmed opening frame. `video_keyframes` defaults to the first shot in this mode; selected later stills are storyboard previews. The combined prompt carries the story goal, fixed asset blocks, style, timecoded shot states, and explicit continuity guidance. It is bounded by the provider's 7000-character prompt limit before submission.

The local image provider fails when a subject reference is supplied without a configured reference-image workflow. The workbench preserves the new shot fields when it projects plans and includes them when it builds a combined regeneration prompt. The director persona instructs the model to review state handoffs and treat the program checks as structural checks rather than semantic plot approval.

## Alternatives considered

**Keep independent video tasks and chain their final frames.** This preserves a motion handoff, but it cannot guarantee shared identity or lighting and conflicts with the ≤15-second single-task goal. It remains available through `per_segment` with `chain` for cases that explicitly need independent routing.

**Generate and submit one reference image for every shot.** The H3 request has one opening-frame slot, so later images would either be ignored or compete with reference conditioning. Keeping later stills as review previews makes that limitation visible to the user.

**Silently drop unsupported references or routing choices.** This would make a successful job appear to honor a story that the backend never received. The tools fail with a repair path instead.

## Consequences

Short stories have a single request-level timeline and a visible opening-frame approval point. The planner must write more structured state, and the program cannot determine whether two prose states are semantically equal; the director review remains responsible for that check. Existing legacy plans with incomplete multi-shot state must be revised or rendered as `per_segment`. A real visual generation still needs provider execution and review; passing the structural checks does not prove visual identity.

Existing character portraits without `referenceLayout: four-column` are incomplete inputs to `video_asset_images`, even when `reference` is present. The tool uses the portrait as identity conditioning and replaces it with one four-column design; completed designs and scene/prop references remain reusable. Failed generation keeps the previous reference record. This prevents library reuse from silently bypassing the four-view requirement without requiring a second character-image format.

Scene consistency uses one canonical layout in the existing asset `prompt` and camera positions in existing shot fields, avoiding independent per-view scene definitions. The director reviews routes before rendering and requests only needed viewpoint previews. Uncast keyframes edit the first selected scene master; cast keyframes retain character conditioning because the image API has one reference source. Text-only generation remains explicit through `identity: text`. Diagram and collage images are review aids, never opening-frame inputs. The renderer still cannot verify spatial semantics or use later multi-shot previews as separate conditioning.

Asset revisions preserve omitted fields, including image references, when the asset id and kind remain the same. Library imports use the same field merge before authored overrides. Replacing the reference clears inherited layout and legacy-sheet metadata unless supplied for the new image; changing asset kind replaces the record. This keeps storyboard edits from detaching generated materials while preventing a replacement portrait from inheriting a four-column declaration.
