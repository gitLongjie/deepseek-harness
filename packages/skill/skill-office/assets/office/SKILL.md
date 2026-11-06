---
name: office
description: Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs. Load to choose the relevant workflow.
---

# Office task routing

Call the `skill` tool with the format skill name before creating, reading, or editing Office files. Standalone rendering, PDF export, and recalculation need only their operation skill.

- Create a **new** file when `create_pptx`, `create_docx`, or `create_xlsx` is available: call that tool with structured content, then `present`. Do not write generator scripts or install packages for new files.
- Read or edit an existing file: `office-docx` (Word), `office-pptx` (PowerPoint), or `office-xlsx` (Excel).
- Images, visual inspection, or tasks primarily about layout, spacing, sizing, or alignment: `office-render`, even without an explicit visual-check request.
- Refresh spreadsheet formula results: `office-recalculate`.
- Export an Office file to PDF: `office-export-pdf`.

Honor requests to skip rendering. New files created through `create_*` tools, content edits, formulas, and incidental formatting such as bold headers or number formats need no render unless visual inspection is requested. Do not reload skills.
