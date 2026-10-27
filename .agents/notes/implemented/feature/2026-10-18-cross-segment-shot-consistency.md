# Agent Note: Separately rendered shots share one look

Status: implemented

English | [中文](2026-10-18-cross-segment-shot-consistency.zh.md)

## Problem

A film longer than one H3 task has to be rendered shot by shot (`per_segment`), and every shot is an independent generation: the model samples a new face, wardrobe, set dressing, and lighting each time. On a multi-shot storyboard the result reads as unrelated clips rather than one scene. Three mechanisms that should have carried consistency were not doing it: the plan's `style` line was stored and documented as "injected into generation prompts" but no prompt ever received it; keyframes were generated from text alone, so the still that anchors each clip invented its own character; and every local submission drew a fresh random seed, so even re-rendering one shot produced a different look.

## Decision

One prompt composer, `segmentPrompt`, now produces the text for both a shot's keyframe and its clip: the shot text, the camera note, the appearance description of every attached asset, and the plan's style line. The still and the clip are therefore described identically, and the style reaches every generation path including asset images.

Asset anchors are matched to shots. A shot is conditioned on the anchored assets whose name its prompt mentions — the character, set, and props that actually appear in it — and on every anchored asset when it names none, so a storyboard that never names its anchors is still conditioned on its full anchor set. Each attached anchor is still labeled in the `References:` line by content order. A character's anchor is a front-facing full-body reference that `video_asset_images` generates on a neutral background, or the photo the user supplied; that single front-facing image is also what the image API documents for character conditioning.

Character assets use one 3:4 full-body reference for review and conditioning. New asset generation does not create a turnaround sheet; older sheet fields remain readable.

Assets persist and keep their wording. Recording an asset writes it to `outputDir/assets/library.json` with its reference and one canonical `prompt` block; that block — not the short human-facing `description` — is copied verbatim into the full-body reference, every keyframe, and every clip, so the wording only changes when someone rewrites it. `video_plan library_assets` attaches a saved asset by name or id, and `video_library` lists what is saved, so a later episode reuses the same cast instead of redefining it.

Keyframes carry the character. When a shot names an anchored character, `video_keyframes` sends that character's portrait as the image API's `subject_reference`, so the still shows the confirmed character before any motion is sampled; the clip then starts from that still (frame conditioning) or keeps the reference set. A local reference path is inlined as a base64 data URI; the API's published limits (one character, PNG/JPEG, under 10 MB) fail loud before submission. Both still tools accept a seed override, and `video_asset_images` accepts `regenerate`, so an accepted portrait or keyframe is reproduced while a rejected one is re-rolled without disturbing the rest.

One seed per plan. `video_plan` accepts an optional `seed`; when omitted, the plan derives one from its own id and creation time and stores it in the plan document. The seed is preserved across revisions, appears in every plan result, and fills the local ComfyUI workflow's seed placeholder, so re-rendering a shot samples the same noise. The hosted H3 API takes no seed parameter and ignores it.

## Alternatives considered

- **Rely on `multi_shot` for consistency.** Rejected: one H3 task is capped at the 15-second ceiling, so films that need several shots cannot use it.
- **Attach every anchored asset to every shot.** Rejected: a shot of one character would carry the rest of the cast and every set as references, which pulls the generation toward elements that are not in the frame. Targeted matching keeps the reference set equal to what the prompt names.
- **Chain the previous shot's last frame into the next shot's first frame.** Required for declared `continue` transitions in `per_segment`. The selected shots must include each predecessor in storyboard order. Missing actual tail frames stop the job; explicit cuts start independently.
- **Generate keyframes from text only.** Rejected: it is the defect this note fixes. A text-only still invents a face, and the clip faithfully reproduces the wrong face.
- **Keep the turnaround sheet as the character anchor.** Rejected: the image API expects one person rather than a multi-view collage. The full-body reference is the only generated character image; user-supplied references remain supported.
- **Redefine assets on every plan.** Rejected: a plan-scoped cast forces each episode to regenerate its characters, which is the drift the project library prevents. The library is keyed by asset name and upserted when an asset is recorded again.
- **Image-to-image the asset into a keyframe.** Rejected: the image API exposes character conditioning as `subject_reference`, not as an image-to-image strength parameter.

## Consequences

- Prompts grow by each attached asset's description and one style line; a plan with several anchors spends more prompt characters per shot, bounded by the existing prompt caps.
- A shot whose prompt names an anchor is conditioned only on the named ones; a storyboard that never names its anchors is conditioned on all of them, and every shot still receives the plan style and seed.
- Keyframes depend on the image API character reference: one full-body image generated by the asset tool, or a user-supplied reference. New runs do not generate a second sheet.
- Character setup costs one image call. Scenes and props also cost one.
- The library lives at `outputDir/assets/library.json`, so it follows the configured output directory: changing `outputDir` starts a library, and assets recorded again under the same name replace the earlier record.
- A plan document carries an optional `seed`; one without it draws a random seed per submission, so such a plan samples fresh noise on every render.
- The seed is local-only. Hosted renders remain non-reproducible in sampling, though prompt, references, and keyframes still carry the look.

## References

- [MiniMax image-to-image API](https://platform.minimax.cn/docs/api-reference/image-generation-i2i) — `subject_reference` with `type: character`, the accepted image formats, and the 10 MB cap.
- [H3 video generation tools](2026-09-29-h3-video-generation-tools.md) — the materials-first flow this note strengthens.
- [AutoDL GPU provisioning](2026-10-18-autodl-gpu-provisioning.md) — the local backend these shots render on.
