# Agent Note: Composer file import stages workspace mentions

Status: implemented

English | [中文](2026-09-13-composer-file-import.zh.md)

## Problem

The resident composer accepted images only. The "+" button opened the command menu and nothing else, the document-level drop overlay invited images alone, and a dropped non-image fell through the image intake's format rejection ("only PNG, JPG, WebP, GIF"), so a user could not hand the agent a PDF, a spreadsheet, or a text file from the chat surface at all. The `@` file-reference pipeline already gave the model a way to read workspace files, but nothing let a user bring an outside file into that pipeline.

## Decision

The composer's "+" launcher now opens a menu with a command entry and an add-files entry (the latter only when the session's file-import Remote is mounted), backed by a hidden multi-file picker. The document-level drop overlay and the paste path accept any file batch, and the composer splits each batch at the MIME boundary: images keep the existing draft-image rail, every other file imports into the session workspace and stages an `@` mention chip through the same reference pipeline the `@` menu uses.

The import seam rides the file-reference capability: `FileReferenceService.import(agent, { name, data }, signal)` stores one externally sourced file — canonical base64 over the wire — and answers with the stored copy's workspace-relative forward-slash path. The local provider writes under the workspace's `importsDirectory` (default `uploads`, `maxImportBytes` default 25 MiB, both plugin config), sanitizes names to bare, filesystem-safe basenames (separators and forbidden characters rejected, Windows device names prefixed), probes the filesystem with exclusive-create writes so a collision or a racing import receives `-1`, `-2`, … suffixes instead of ever overwriting, removes a partial copy when the caller aborts, and marks the agent's search cache stale. Session Controller exposes the verb as the generated `fileReferences/import` Remote, and the client's `ConversationController.importFiles` is scope-addressed: one outcome per file, so one refusal never withholds another file's stored path.

On the client the imported path renders through `formatFileMention` (whitespace paths quote) and `shell.insertReference`, so submission serializes to the same `@path` / `@"path with spaces"` text the `@` menu produces, stays fully logged as ordinary prompt text, and the model reads the file with its existing filesystem tools. No message-content shape, session event, or attachment format changed.

## Testing

`file-reference-local` specs cover import admission (canonical base64, size ceiling, name sanitization, collision suffixes, abort cleanup, config validation) and `file-reference` pins the abstract pair; the Session Controller adapter spec asserts the delegation. Client-side, the input-bar spec covers the launcher menu, capability gating, MIME split, and failure toasts; the apply file-import spec drives the real assembly end to end (chip staging, quoted mentions, localized failures, absent-Remote behavior); the orchestration spec covers per-file independence and scope addressing; the ui-attachment and fixture specs follow the renamed `onAddFiles` contract.

## Alternatives considered

**Attach files to the message like images.** Rejected: the durable attachment path and every provider request encoder are image-specific (normalization, EXIF orientation, pixel ceilings), and the wire has no document content block, so arbitrary files would need a new request vocabulary across every provider for something the existing filesystem tools already read.

**Reference dropped files in place.** Rejected: a browser `File` carries no stable path on the web target, an absolute local path would leak host layout into the prompt and break workspace sandbox assumptions, and the mention would die with the file's original location instead of traveling with the session's workspace.

**Extend the "+" popover inside the command menu system.** Rejected: the command menu is a trigger-source popup with its own pick grammar; grafting a non-command entry into it couples the file feature to the trigger pipeline. A separate `Menu` over the same button keeps both entries one click away without that coupling.

## Consequences

Users can hand the agent any file from the composer, and the imported copy lives inside the workspace the agent already reads — visible, tool-addressable, and covered by the mention grammar's prompt guidance. The trade-offs: imported bytes are stored twice (workspace copy plus whatever the user keeps elsewhere), a `uploads/` directory appears in workspaces that receive imports, and the 25 MiB default ceiling bounds what one message can carry — deployments with heavier needs raise `maxImportBytes`.
