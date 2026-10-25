# Agent Note: Plan ids are numbered per output directory

Status: implemented

English | [中文](2026-10-20-plan-ids-per-directory.zh.md)

## Problem

`video_plan` allocated `vp-<n>` from a counter that lived in the tool instance, which is per session, while every session writes into one output directory. A second session therefore started at `vp-1` again and `writePlan` replaced the first project's plan file. The keyframes, segments, and final cut kept their names, so they stopped being referenced by any plan and the workbench showed the new project as already rendered. Nothing failed; the data was simply replaced.

## Decision

The id series lives with the artifacts it names: `allocatePlanId` reads `plans/vp-<n>.json` names, takes the highest number, and returns the next free one, skipping names a concurrent call in this process already reserved but has not written yet. A directory with no plans starts at `vp-1`, so a single project is unaffected.

Ids are not made globally unique across output directories: two deployments pointing at different directories both start at `vp-1` deliberately, because the id only has to be unique among the artifacts in one directory.

## Alternatives considered

- **Namespace artifacts by session** (`<sessionId>/plans/vp-1.json`). Rejected: the workbench, the assembly paths, and the file route all project one flat directory, and a session id is not a durable project identity — resuming or forking a session renames nothing but changes the id.
- **Keep the session counter and refuse to overwrite an existing plan file.** Rejected: a refusal at write time loses the plan the model just composed, and the retry has to renumber anyway.

## Consequences

- A directory accumulates one id series across sessions. `vp-1` is never reused, so a finished project's artifacts stay addressable.
- Ids can grow large on a long-lived directory; the series is not compacted.

## Verification

- Two agents in one process, one output directory: the second `video_plan` returns `vp-2`.
- A stray `plans/vp-7.json` makes the next allocation return `vp-8`.
