---
description: "First-class create_pptx, create_docx, and create_xlsx tools for new Office files."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-office-create

English | [中文](README.zh.md)

## Overview

Registers `create_pptx`, `create_docx`, and `create_xlsx` so the model can create new Office Open XML files through the bundled primary runtime. Desktop mounts this plugin with Office skills; the tools prepare the offline payload automatically and never ask the user to install packages.

## Use this package

Mount beside `@deepseek-ai/dsh-tool-workspace-dependencies` with the same `source` / `root` payload config:

```yaml
- name: '@deepseek-ai/dsh-tool-office-create'
  config:
    source: /absolute/primary-runtime
    root: /absolute/dsh-home/dsh-runtimes/dsh-primary-runtime
```

| Field | Default | Meaning |
|---|---|---|
| `source` | required | Absolute primary-runtime directory with `runtime.json`. |
| `root` | unset | Optional Harness-home install directory; when set, first create call installs offline. |

After a successful create, the model should call `present` with the path. Editing, rendering, recalculation, and PDF export stay on Office skills.

## Understand the implementation

The Host validates structured arguments, resolves the Session working-directory path, prepares the primary runtime, and runs `assets/generate_office.py` with JSON on stdin. Failed runs delete incomplete outputs. Prompt guidance tells the model to prefer these tools for new files.

## Model Experience

### Request context and condition

#### What the model sees

Three tools plus a short system-prompt section when `create_pptx` is registered. Generated schemas live in the [tool catalog](../../../docs/tool-catalog.md).

#### Token effect

Conditional: the guidance section is empty when the tools are absent from the Agent scope.

#### KV Cache effect

Tool declarations participate in the ordinary tool-schema cache key for the composition.

## Known Limitations and Deferred Work

- Designed presentations use the bundled `dashi-ppt` skill. `create_pptx` remains the plain Office file. Edits to an existing file stay on `office-pptx`.
- PDF export stays on `office-export-pdf`.
- Ordinary Web and shared base do not mount these tools in phase 1.
