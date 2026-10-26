# Agent Note: Smooth transitions between rendered video clips

Status: implemented

English | [中文](2026-10-21-video-assembly-crossfade.zh.md)

## Problem

Per-segment assembly joins independently generated clips with hard cuts by default. The previous dip implementation requires audio on every clip and silently replaces a failed dip with a hard cut. A request for smoother transitions can therefore deliver the same abrupt joins.

## Decision

`video_assemble` resolves an omitted transition to `crossfade` with a configurable per-call overlap of 0.4 seconds. `cut` remains explicit, and `dip` retains a default half-width of 0.25 seconds. The underlying service preserves its direct-cut default for other consumers. Multi-shot assembly returns the already combined clip without applying transitions.

Transition assembly uses ffprobe beside the selected ffmpeg executable or on PATH to discover video dimensions and audio presence. It normalizes video to the first clip's dimensions and 24 fps, preserves aspect ratio with padding, normalizes audio to stereo at 48 kHz, and supplies silence for missing audio. Each clip is trimmed or padded to its supplied planned duration. Crossfades combine video with `xfade` and audio with `acrossfade`; each overlap is capped at half of either adjacent clip. Dips apply fades to each clip before concatenation. Invalid timing and processing failures reject without falling back to hard cuts.

The assembly result allows fractional seconds and subtracts crossfade overlaps from the planned duration. No plan-file or Session event fields change.

## Alternatives considered

**Use dips for every join.** A fade through black creates a pause between shots. Crossfades provide the requested overlap without a black interval; dips remain available for scene changes.

**Regenerate all clips with chained first frames.** Generation continuity addresses different pictures and actions. It does not replace the requested editing transition and incurs another rendering cost.

**Return a hard cut after transition failure.** This conceals the missing effect. The caller receives the failure and can explicitly choose a cut.

## Consequences

Existing clips can be assembled again without regeneration. Crossfades overlap audio and can overlap dialogue near a join; callers choose shorter overlaps or cuts where speech timing requires them. Transition processing requires ffprobe and re-encodes the video. The operation does not alter internal cuts already present in a single generated multi-shot clip.

Real ffmpeg tests inspect decoded pixels on both sides of consecutive joins, audio levels through a fade, duration, silent inputs, mixed frame rates and dimensions, and overlap caps. A real Loader composition calls the model-facing assembly tool and retrieves the output through the workbench. An owner-local schema snapshot pins the model-visible transition choices; the scenario uses generated media files and does not replay a recorded Session.
