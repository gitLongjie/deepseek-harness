# Agent Note: Desktop first-class Office create tools

Status: implemented

English | [中文](2026-11-06-desktop-office-create-tools.zh.md)

## Problem

Desktop already ships Office skills, a bundled Python payload with `python-pptx` / `python-docx` / `openpyxl`, shell tools, and `present`. Creating a new PPTX/DOCX/XLSX still depends on the model writing and running a script. Sessions commonly refuse with “I can only write text files” or invent `pip install`, so users cannot get Office files from chat without operating the shell themselves.

## Decision

Desktop mounts `@deepseek-ai/dsh-tool-office-create` beside `load_workspace_dependencies` and Office skills. The Electron shell boots the profile **in-process** and calls `mountDesktopOffice` after `runDesktopBoot` (the child `dsh-desktop-host` composition keeps the same plugins for smoke/runtime paths). The model creates **new** files with `create_pptx`, `create_docx`, and `create_xlsx` using structured JSON arguments. The Host prepares the same offline primary-runtime payload and runs a fixed generator script; users never install packages. Successful creates append `deliverables/presented` so the delivery card appears, and the Desktop shell opens the file with the OS default application (binary Office files cannot usefully show a text diff). Editing, rendering, recalculation, and PDF export remain on Office skills and ordinary shell execution ([progressive Office skills](../architecture/2026-09-27-progressive-office-skills.md)).

## Alternatives considered

**Prompt-only reliability work.** It does not remove the scripted binary-write path that models refuse.

**One `create_office` tool.** A single fat schema is harder for the model than per-format tools.

**Auto-`present` inside create tools.** Delivery stays an explicit Session declaration owned by `present`.

**Mount on ordinary Web in phase 1.** Web lacks the Desktop primary-runtime carrier; SDK can reuse the package later with the same payload config.

## Consequences

New model-facing tools and Desktop composition wiring. Skill create guidance points models at `create_*` when present. Schema expressiveness is capped; complex decks still use skills. Phase 1 does not add a dedicated PDF create/export tool.
