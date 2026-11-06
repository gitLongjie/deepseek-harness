#!/usr/bin/env python3
"""Create a minimal OOXML Office file from a JSON payload on stdin."""

from __future__ import annotations

import json
import sys
from pathlib import Path


FONT = "微软雅黑"
INK = (0x07, 0x0D, 0x18)
PAPER = (0xF5, 0xF7, 0xFC)
WHITE = (0xFF, 0xFF, 0xFF)
TEAL = (0x1F, 0xD1, 0xA6)
BLUE = (0x3B, 0x82, 0xF6)
TEXT = (0x10, 0x1A, 0x2B)
MUTED = (0x5B, 0x6A, 0x82)
DARK_MUTED = (0xC5, 0xD4, 0xE8)
CARD = (0xFF, 0xFF, 0xFF)
LINE = (0xE2, 0xE8, 0xF2)


def _rgb(color: tuple[int, int, int]):
    from pptx.dml.color import RGBColor

    return RGBColor(*color)


def _fill(shape, color: tuple[int, int, int]) -> None:
    shape.fill.solid()
    shape.fill.fore_color.rgb = _rgb(color)
    shape.line.fill.background()


def _apply_font(run, size: int, color: tuple[int, int, int], bold: bool = False) -> None:
    from pptx.oxml.ns import qn
    from pptx.util import Pt

    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = _rgb(color)
    properties = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:ea", "a:cs"):
        element = properties.find(qn(tag))
        if element is None:
            element = properties.makeelement(qn(tag))
            properties.append(element)
        element.set("typeface", FONT)


def _write(paragraph, text: str, size: int, color: tuple[int, int, int], bold: bool = False) -> None:
    run = paragraph.add_run()
    run.text = text
    _apply_font(run, size, color, bold)


def _background(slide, color: tuple[int, int, int]) -> None:
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    _fill(shape, color)
    shape.shadow.inherit = False


def _bar(slide, x: float, y: float, w: float, h: float, color: tuple[int, int, int]) -> None:
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    _fill(shape, color)
    shape.shadow.inherit = False


def _textbox(slide, x: float, y: float, w: float, h: float):
    from pptx.enum.text import MSO_ANCHOR
    from pptx.util import Inches

    frame = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)).text_frame
    frame.word_wrap = True
    frame.auto_size = None
    frame.margin_left = 0
    frame.margin_right = 0
    frame.margin_top = 0
    frame.margin_bottom = 0
    frame.vertical_anchor = MSO_ANCHOR.TOP
    return frame


def _notes(slide, notes: str | None) -> None:
    if notes:
        slide.notes_slide.notes_text_frame.text = notes


def _cover(slide, title: str, bullets: list[str]) -> None:
    _background(slide, INK)
    _bar(slide, 0, 0, 0.12, 7.5, TEAL)
    title_frame = _textbox(slide, 0.85, 2.15, 11.4, 1.7)
    _write(title_frame.paragraphs[0], title, 40, WHITE, True)
    if not bullets:
        return
    body = _textbox(slide, 0.85, 4.15, 11.2, 2.4)
    for index, bullet in enumerate(bullets[:8]):
        paragraph = body.paragraphs[0] if index == 0 else body.add_paragraph()
        paragraph.space_after = 101600  # 8pt
        _write(paragraph, bullet, 18, DARK_MUTED)


def _content(slide, title: str, bullets: list[str], number: int, total: int) -> None:
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches, Pt

    _background(slide, PAPER)
    _bar(slide, 0, 0, 13.333, 0.08, BLUE)
    title_frame = _textbox(slide, 0.7, 0.38, 11.6, 0.85)
    _write(title_frame.paragraphs[0], title, 30, TEXT, True)
    _bar(slide, 0.7, 1.32, 0.72, 0.045, TEAL)
    footer = _textbox(slide, 11.4, 7.05, 1.3, 0.28)
    footer.paragraphs[0].alignment = 2
    _write(footer.paragraphs[0], f"{number}  /  {total}", 12, MUTED)
    if not bullets:
        return
    if len(bullets) > 6:
        body = _textbox(slide, 0.85, 1.7, 11.6, 5.1)
        for index, bullet in enumerate(bullets):
            paragraph = body.paragraphs[0] if index == 0 else body.add_paragraph()
            paragraph.level = 0
            paragraph.space_after = Pt(10)
            _write(paragraph, f"▸  {bullet}", 18, TEXT)
        return
    top = 1.65
    gap = 0.12
    height = min(0.78, (5.2 - gap * (len(bullets) - 1)) / len(bullets))
    for index, bullet in enumerate(bullets):
        y = top + index * (height + gap)
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.7), Inches(y), Inches(11.9), Inches(height))
        _fill(card, CARD)
        card.line.color.rgb = _rgb(LINE)
        card.shadow.inherit = False
        _bar(slide, 0.7, y, 0.08, height, TEAL if index % 2 == 0 else BLUE)
        body = _textbox(slide, 1.0, y + 0.14, 11.3, height - 0.2)
        _write(body.paragraphs[0], bullet, 18, TEXT)


def create_pptx(output: Path, payload: dict) -> None:
    from pptx import Presentation
    from pptx.util import Inches

    presentation = Presentation()
    presentation.slide_width = Inches(13.333)
    presentation.slide_height = Inches(7.5)
    blank = presentation.slide_layouts[6]
    slides = payload["slides"]
    total = len(slides)
    for index, slide_spec in enumerate(slides):
        slide = presentation.slides.add_slide(blank)
        title = slide_spec["title"]
        bullets = slide_spec.get("bullets") or []
        if index == 0:
            _cover(slide, title, bullets)
        else:
            _content(slide, title, bullets, index + 1, total)
        _notes(slide, slide_spec.get("notes"))
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
    # The Host writes UTF-8 JSON; the locale stdin codec (cp936 on Chinese Windows) would corrupt it.
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
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
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 — surface any library failure to the Host tool
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
