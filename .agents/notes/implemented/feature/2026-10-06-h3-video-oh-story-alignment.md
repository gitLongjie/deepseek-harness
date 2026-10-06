# Agent Note: Aligning the H3 video practice with oh-story-dsh

Status: implemented

English | [中文](2026-10-06-h3-video-oh-story-alignment.zh.md)

## Problem

The community [oh-story-dsh](https://github.com/zenstory-ai/oh-story-dsh) drama workbench also generates video through MiniMax H3, and its adapter (`short-drama-produce/references/providers/minimax-h3-video.md` + `provider_adapters.py`) publishes facts our h3-video/tool-video had not caught up with:

- **Capability envelopes are deployment configuration.** Which release an account has enabled, and what resolutions/durations it accepts, differ per release — the oh-story adapter deliberately has no model default and configures resolutions/durations explicitly. We had pinned `model` to the `MiniMax-H3`/`MiniMax-H3-Max` enum and hardcoded capabilities by model name: every future release would need a code change, and accounts on custom endpoints could not be configured at all.
- **We implemented only half the protocol constraints.** At most one first and one last frame, reference-count caps (9 images / 3 videos / 3 audios), `mm_file://{file_id}` references, per-modality inline caps (30/50/15 MB) and the 64 MB whole-body cap — none of these published rules were validated, so an over-cap request reached the provider and came back with an unattributed error.
- **Our assembly silently dropped anchors when frame and reference conditioning collided.** `tool-video` skipped asset references whenever a keyframe (first_frame) existed — the user's character/scene references were discarded without a word, violating "never silently skip a missing referent".
- **Multimodal references need in-prompt labels.** The oh-story compiler appends `<Picture N>`/`<Video N>`/`<Audio N>` tokens; MiniMax's full-reference semantics map prompt text onto content items through them. We sent reference material with no labels at all.
- **H3 generates audio in the same pass.** oh-story's dialect doc (`short-drama-video-prompts/references/minimax-h3.md`) records field observations: an unstated sound layer tends to add unwanted music — `non_diegetic_music: N/A` must be written explicitly — and Chinese dialogue goes verbatim inside `<d>[Chinese] 台词</d>`. Our `/video` flow and tool descriptions carried no sound-layer guidance.

## Decision

- **Configurable capability envelopes** (h3-video): `minimax.model` widens to any release id; new `minimax.resolutions`/`minDurationSeconds`/`maxDurationSeconds` override the envelope. Known ids (H3, H3-Max) keep their published envelopes built in; an id with no built-in envelope and no explicit profile fails at construction (fail loud, no guessing). The settings card (`ui-settings-plugins`) exposes the three new fields and maps them into the overlay.
- **Protocol validation completed** (h3-video): `validateSegmentRequest` gains frame uniqueness and the 9/3/3 count caps; `toApiUrl` passes `mm_file://` through and refuses a local file past its per-modality cap; `toBody` refuses a body over 64 MB after base64 expansion, with the https-URL alternative named in the message.
- **Full-reference unification** (tool-video): `withKeyframe` + `withAssetReferences` merge into `buildSegmentRequest`. Once a shot carries any reference material (authored references or asset anchors), everything unifies on reference_image conditioning — the keyframe or authored frame input degrades instead of dropping anchors — and a contract line (`References: <Picture 1> opening keyframe; <Picture 2> …`) labeling every attached item in content order is appended to the prompt; a lone keyframe still renders as first_frame image-to-video. The degraded request keeps its authored ratio (adaptive is legal under full-reference).
- **Same-pass audio guidance** (tool-video): the `/video` turn prompt and the `video_plan` prompt-parameter description now state the sound layers (ambience/SFX, `<d>[Chinese] 台词</d>`, `non_diegetic_music: N/A`), matching the oh-story dialect findings; the wording lives in model instructions, not adapter-generated boilerplate.

## Alternatives considered

- **Porting oh-story's six-section dialect template (subject_definitions/retention_analysis …).** Rejected: that is prompt engineering for their drama skills and depends on the 用途/控制 slots of their storyboard documents; our plan schema has no such authored concepts, and pasting it into the tool layer would be boilerplate, not configuration.
- **Rejecting a frame+reference collision with an error.** Rejected: both sides are user-supplied; oh-story's decision table unifies that combination on full-reference, and degrading to keep every anchor serves the materials-first flow better than an error.
- **Validating the 2–15s length of reference video/audio clips.** Not done: it needs ffprobe probing, and oh-story likewise does not measure it (their doc pushes the bound to configuration); count and size caps already stop the worst abuse.
- **Switching the default baseUrl to oh-story's `https://api.minimax.io/v2`.** Not changed: our users sit on `api.minimax.cn`, and baseUrl is already a config field.

## Consequences

- An unknown MiniMax release id (H3.5, account-specific endpoints) can be onboarded from the settings card without a release; the cost is that a misconfigured envelope surfaces at service construction (load or overlay rebuild), with the message naming the missing fields.
- A shot with both a keyframe and asset anchors now sends reference conditioning instead of frame conditioning: the opening-composition constraint weakens in exchange for never dropping the anchors; `routing`'s validation guarantees the two kinds never mix, so the local ComfyUI frame+ref rejection path is unreachable (the guard stays).
- The appended contract line is model-visible and replays with the request (the `toSegmentRequest` product is what is submitted); snapshots are unaffected (no keyless snapshot covers this path in tool-video).
- A future Seedance channel (oh-story publishes that adapter contract too) can reuse the `PUBLISHED_ENVELOPES` + explicit-profile structure directly: a new provider row needs only its own envelope table and endpoints.

## References

- oh-story-dsh MiniMax H3 adapter reference: `packages/knowledge/drama/skills/short-drama-produce/references/providers/minimax-h3-video.md` (upstream repository)
- oh-story-dsh H3 prompt dialect: `packages/knowledge/drama/skills/short-drama-video-prompts/references/minimax-h3.md` (upstream repository)
- This repository: `packages/experimental/h3-video/src/minimax-api.ts`, `src/validation.ts`, `src/index.ts`, `src/settings.ts`, `packages/experimental/tool-video/src/index.ts`, `packages/client/ui-settings-plugins/src/client/h3-video-card-controller.ts`
