# Agent Note: Video workbench storyboard and shared-asset consistency

Status: implemented

English | [中文](2026-10-21-video-workbench-consistency.zh.md)

## Problem

The video pipeline records authored shots and reuses character, scene, and prop images across plans. Grouping a multi-shot render into `all` hides the original shot settings in the workbench. Independent browser listing declarations can drift from the host response. Removing an episode or asset can also break later episodes when they still reference its images.

## Decision

The host listing owns the browser's type-only data declarations. Each render row carries its authored `shots` in plan order; `all` remains the render task id. The browser displays shot prompts and generation settings, uses a complete-storyboard regeneration request for `all`, and reports absent clips as not rendered. The completed multi-shot clip is also the final video, matching `video_assemble` without requiring a separate final-directory artifact. Listing errors remain visible when every plan is unreadable. A request counter prevents an older listing from replacing a newer refresh or updating an unmounted page.

Project and asset deletion retain files referenced by other plans’ assets or authored segment materials, remaining assets or segments in the same plan, or the asset library. Relative and absolute image paths use the file resolver's directory and symlink checks. Recovery directories have atomically allocated unique suffixes. Asset deletion backs up the original plan; a failed move or plan write restores already-moved files and reports the failure. Unreadable referring documents block deletion because their references are unknown. Malformed deletion JSON returns a JSON error with status 400, and malformed plan documents become individual listing errors.

The reference is [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app), whose README organizes scripts, assets, and clips together. Its [asset utilities](https://github.com/HBAI-Ltd/Toonflow-app/blob/master/apps/server/src/utils/assets/index.ts) resolve assets under a dedicated root and check revisions on writes; its [video settings component](https://github.com/HBAI-Ltd/Toonflow-app/blob/master/packages/nodes/videoGenerationNode/src/components/generationSettings.vue) keeps duration, resolution, ratio, and generation mode explicit. These practices inform the projection and reference handling; this implementation retains Cordis plugins and the existing file-based pipeline.

## Alternatives considered

**Import the complete upstream application.** Its canvas, Vue components, and runtime do not fit the existing Cordis slots and React client. The current pipeline already owns generation and paid-operation confirmation.

**Keep only the synthetic render row.** This loses the authored shot ids and settings needed to review a multi-shot storyboard.

**Trash every file with the deleted plan's prefix.** Prefix ownership does not imply exclusive use: the project library and subsequent plans can retain references to those images.

## Consequences

Existing plan JSON remains unchanged. Browser types follow the host response without bundling host runtime code. Shared images can outlive the episode that created them; removing unused library assets remains a separate operation. Deletion is not coordinated with active generation or other processes, so users delete only after render jobs settle.

Focused tests cover corrupt-plan isolation, legacy default mode, storyboard retention, completed multi-shot projection, shared materials and relative image handling, rollback, invalid request bodies, and stale refreshes. The real Loader composition drives the generation tools, reads their output through Connection, and retrieves the resulting media. The browser keeps an owner-local expected storyboard rendering because that display is driven by project files rather than a recorded Session. External paid providers and packaged desktop playback are not exercised by these tests.
