# Agent Note: Character assets use one full-body reference image

Status: implemented

English | [中文](2026-10-27-video-character-full-body-reference.zh.md)

## Problem

Character asset generation could produce a cropped portrait and a separate turnaround image. Later video prompts then had two visual records for clothing, shoes, body proportions, and expression, which made identity drift harder to diagnose.

## Decision

`video_asset_images` generates exactly one 3:4 image for each character. The prompt requires one centered standing person with the complete head-to-shoes figure visible, including hands, clothing, shoes, accessories, and body proportions. It excludes half-body crops, multiple views, collages, text, and watermarks. The reference is saved on the plan and in the project library and is the only character image used for keyframes and clips.

The director derives observable age, build, face, hair, makeup, gaze, mouth, wardrobe, shoes, accessories, posture, and exclusion constraints from the story and supplied evidence before calling the tool. Users provide story information or existing images; they do not need to write image prompts manually. `regenerate` replaces the selected reference and removes any legacy `sheet` field from the new record.

Legacy plans may still contain `sheet` for read compatibility. New generation never creates a sheet, and the library can still display an old sheet without sending it to a new render.

## Alternatives considered

**Keep both images and tell prompts which one wins.** Rejected because the workbench and model context still contain competing depictions.

**Use a multi-view sheet as the sole anchor.** Rejected because a wide layout is a poor subject-reference input and does not provide one clean full-body image.

**Regenerate every existing character automatically.** Rejected because it would spend image-generation work without an explicit request. Existing references remain stable until `regenerate` is requested.

## Consequences

Each new character uses one image request. A single full-body source reduces clothing and proportion conflicts, but it cannot prove the unseen back of a costume; video output still needs visual review. The structural tests assert one request, 3:4 ratio, full-body constraints, legacy read compatibility, and regeneration cleanup.
