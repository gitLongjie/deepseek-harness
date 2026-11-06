#!/usr/bin/env python3
"""Create a minimal OOXML Office file from a JSON payload on stdin."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def create_pptx(output: Path, payload: dict) -> None:
    from pptx import Presentation
    from pptx.util import Inches, Pt

    presentation = Presentation()
    presentation.slide_width = Inches(13.333)
    presentation.slide_height = Inches(7.5)
    blank = presentation.slide_layouts[6]
    for slide_spec in payload["slides"]:
        slide = presentation.slides.add_slide(blank)
        title_box = slide.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(12.1), Inches(0.9))
        title_paragraph = title_box.text_frame.paragraphs[0]
        title_run = title_paragraph.add_run()
        title_run.text = slide_spec["title"]
        title_run.font.size = Pt(28)
        bullets = slide_spec.get("bullets") or []
        if bullets:
            body = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(11.7), Inches(5.2))
            frame = body.text_frame
            frame.clear()
            for index, bullet in enumerate(bullets):
                paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
                paragraph.text = bullet
                paragraph.level = 0
                paragraph.font.size = Pt(18)
        notes = slide_spec.get("notes")
        if notes:
            slide.notes_slide.notes_text_frame.text = notes
    presentation.save(output)


def create_docx(output: Path, payload: dict) -> None:
    from docx import Document
    from docx.shared import Pt

    document = Document()
    for block in payload["blocks"]:
        kind = block["type"]
        if kind == "heading":
            level = int(block.get("level") or 1)
            level = min(9, max(1, level))
            document.add_heading(block.get("text") or "", level=level)
        elif kind == "paragraph":
            paragraph = document.add_paragraph(block.get("text") or "")
            for run in paragraph.runs:
                run.font.size = Pt(11)
        elif kind == "bullet_list":
            for item in block.get("items") or []:
                document.add_paragraph(item, style="List Bullet")
        else:
            raise ValueError(f"unsupported docx block type: {kind}")
    document.save(output)


def create_xlsx(output: Path, payload: dict) -> None:
    from openpyxl import Workbook

    workbook = Workbook()
    default = workbook.active
    workbook.remove(default)
    for sheet_spec in payload["sheets"]:
        sheet = workbook.create_sheet(title=sheet_spec["name"])
        for row_index, row in enumerate(sheet_spec.get("rows") or [], start=1):
            for column_index, value in enumerate(row, start=1):
                sheet.cell(row=row_index, column=column_index, value=value)
    if len(workbook.sheetnames) == 0:
        workbook.create_sheet(title="Sheet1")
    workbook.save(output)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_office.py <pptx|docx|xlsx> <output-path>", file=sys.stderr)
        return 2
    kind = sys.argv[1]
    output = Path(sys.argv[2])
    payload = json.load(sys.stdin)
    output.parent.mkdir(parents=True, exist_ok=True)
    if kind == "pptx":
        create_pptx(output, payload)
    elif kind == "docx":
        create_docx(output, payload)
    elif kind == "xlsx":
        create_xlsx(output, payload)
    else:
        print(f"unsupported kind: {kind}", file=sys.stderr)
        return 2
    if not output.is_file() or output.stat().st_size < 4:
        print("generator produced no usable file", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 — surface any library failure to the Host tool
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
