#!/usr/bin/env python3
"""Build VECTOR AI's deterministic, bundled knowledge index from DOCX sources.

The script intentionally uses only Python's standard library. DOCX files are ZIP
containers, so reading OOXML directly keeps the build reproducible and lets us
preserve Word OMML equations that ordinary DOCX-to-text converters often drop.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "knowledge_sources"
OUTPUT_PATH = ROOT / "public" / "knowledge" / "builtin-knowledge.json"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"


def qn(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}"


def local_name(element_or_tag: ET.Element | str) -> str:
    tag = element_or_tag.tag if isinstance(element_or_tag, ET.Element) else element_or_tag
    return tag.rsplit("}", 1)[-1]


SOURCES = (
    {
        "id": "trinh-sat-tren-khong",
        "title": "Trinh Sát Trên Không",
        "filename": "Trinh Sat Tren Khong.docx",
    },
    {
        "id": "so-tay",
        "title": "Sổ Tay",
        "filename": "So Tay.docx",
    },
    {
        "id": "si-quan-cao-xa",
        "title": "Sĩ Quan Cao Xạ",
        "filename": "Si Quan Cao Xa.docx",
    },
)


LATEX_TEXT_REPLACEMENTS = (
    ("−", "-"),
    ("–", "-"),
    ("×", r"\times "),
    ("∙", r"\cdot "),
    ("⋅", r"\cdot "),
    ("÷", r"\div "),
    ("≤", r"\le "),
    ("≥", r"\ge "),
    ("≠", r"\ne "),
    ("≈", r"\approx "),
    ("∞", r"\infty "),
    ("±", r"\pm "),
    ("∓", r"\mp "),
    ("→", r"\to "),
    ("←", r"\leftarrow "),
    ("°", r"^{\circ}"),
)

NARY_MAP = {
    "∑": r"\sum",
    "∫": r"\int",
    "∬": r"\iint",
    "∭": r"\iiint",
    "∏": r"\prod",
    "∐": r"\coprod",
    "⋂": r"\bigcap",
    "⋃": r"\bigcup",
}

DELIMITER_MAP = {
    "{": r"\{",
    "}": r"\}",
    "〈": r"\langle",
    "〉": r"\rangle",
    "⟨": r"\langle",
    "⟩": r"\rangle",
    "|": r"\lvert",
}


@dataclass(frozen=True)
class Block:
    text: str
    kind: str
    index: int


def node_value(node: ET.Element | None, default: str = "") -> str:
    if node is None:
        return default
    for key in (qn(M_NS, "val"), qn(W_NS, "val"), "val"):
        if key in node.attrib:
            return node.attrib[key]
    return default


def direct_child(node: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in node if local_name(child) == name), None)


def property_value(node: ET.Element, name: str, default: str = "") -> str:
    match = next((item for item in node.iter() if local_name(item) == name), None)
    return node_value(match, default)


def latex_text(value: str) -> str:
    value = value.replace("\u00a0", " ")
    for source, replacement in LATEX_TEXT_REPLACEMENTS:
        value = value.replace(source, replacement)
    return value


def math_part(node: ET.Element, name: str) -> str:
    child = direct_child(node, name)
    return math_to_latex(child) if child is not None else ""


def math_children(node: ET.Element) -> str:
    return "".join(
        math_to_latex(child)
        for child in node
        if not local_name(child).endswith("Pr")
        and local_name(child) not in {"ctrlPr", "argPr"}
    )


def delimiter(value: str, fallback: str) -> str:
    if not value:
        value = fallback
    return DELIMITER_MAP.get(value, value)


def math_to_latex(node: ET.Element | None) -> str:
    if node is None:
        return ""
    tag = local_name(node)

    if tag.endswith("Pr") or tag in {"ctrlPr", "argPr"}:
        return ""
    if tag == "t":
        return latex_text(node.text or "")
    if tag in {"r", "oMath", "oMathPara", "e", "num", "den", "sub", "sup", "deg", "lim", "fName"}:
        return math_children(node)
    if tag == "f":
        return rf"\frac{{{math_part(node, 'num')}}}{{{math_part(node, 'den')}}}"
    if tag == "sSub":
        return rf"{{{math_part(node, 'e')}}}_{{{math_part(node, 'sub')}}}"
    if tag == "sSup":
        return rf"{{{math_part(node, 'e')}}}^{{{math_part(node, 'sup')}}}"
    if tag == "sSubSup":
        return rf"{{{math_part(node, 'e')}}}_{{{math_part(node, 'sub')}}}^{{{math_part(node, 'sup')}}}"
    if tag in {"sPre", "preSubSup"}:
        return rf"{{}}_{{{math_part(node, 'sub')}}}^{{{math_part(node, 'sup')}}}{{{math_part(node, 'e')}}}"
    if tag == "rad":
        body = math_part(node, "e")
        degree = math_part(node, "deg")
        return rf"\sqrt[{degree}]{{{body}}}" if degree else rf"\sqrt{{{body}}}"
    if tag == "d":
        begin = delimiter(property_value(node, "begChr", "("), "(")
        end = delimiter(property_value(node, "endChr", ")"), ")")
        separator = property_value(node, "sepChr", "|")
        entries = [math_to_latex(child) for child in node if local_name(child) == "e"]
        body = separator.join(entries) if entries else math_children(node)
        return rf"\left{begin}{body}\right{end}"
    if tag == "nary":
        symbol = property_value(node, "chr", "∫")
        operator = NARY_MAP.get(symbol, latex_text(symbol))
        lower = math_part(node, "sub")
        upper = math_part(node, "sup")
        body = math_part(node, "e")
        limits = (rf"_{{{lower}}}" if lower else "") + (rf"^{{{upper}}}" if upper else "")
        return rf"{operator}{limits} {body}"
    if tag == "acc":
        body = math_part(node, "e")
        accent = property_value(node, "chr", "^")
        command = {
            "¯": "overline", "̅": "overline", "^": "hat", "ˆ": "hat",
            "→": "vec", "˙": "dot", "¨": "ddot", "~": "tilde", "̃": "tilde",
        }.get(accent)
        return rf"\{command}{{{body}}}" if command else rf"\overset{{{latex_text(accent)}}}{{{body}}}"
    if tag == "bar":
        body = math_part(node, "e")
        position = property_value(node, "pos", "top")
        return rf"\underline{{{body}}}" if position == "bot" else rf"\overline{{{body}}}"
    if tag == "limLow":
        return rf"\underset{{{math_part(node, 'lim')}}}{{{math_part(node, 'e')}}}"
    if tag == "limUpp":
        return rf"\overset{{{math_part(node, 'lim')}}}{{{math_part(node, 'e')}}}"
    if tag == "func":
        return f"{math_part(node, 'fName')} {math_part(node, 'e')}"
    if tag == "groupChr":
        body = math_part(node, "e")
        character = property_value(node, "chr", "⏞")
        position = property_value(node, "pos", "top")
        if character in {"⏞", "⌢"}:
            return rf"\overbrace{{{body}}}"
        if character in {"⏟", "⌣"} or position == "bot":
            return rf"\underbrace{{{body}}}"
        return rf"\overset{{{latex_text(character)}}}{{{body}}}"
    if tag == "eqArr":
        rows = [math_to_latex(child) for child in node if local_name(child) == "e"]
        return r"\begin{aligned}" + r" \\ ".join(rows) + r"\end{aligned}"
    if tag == "m":
        rows = []
        for row in (child for child in node if local_name(child) == "mr"):
            entries = [math_to_latex(child) for child in row if local_name(child) == "e"]
            rows.append(" & ".join(entries))
        return r"\begin{matrix}" + r" \\ ".join(rows) + r"\end{matrix}"
    if tag in {"box", "borderBox", "phant"}:
        return math_part(node, "e") or math_children(node)
    return math_children(node)


def inline_text(node: ET.Element) -> str:
    tag = local_name(node)
    namespace = node.tag[1:].split("}", 1)[0] if node.tag.startswith("{") else ""
    if namespace == W_NS and tag in {"t", "instrText", "delText"}:
        return node.text or ""
    if namespace == W_NS and tag == "tab":
        return "\t"
    if namespace == W_NS and tag in {"br", "cr"}:
        return "\n"
    if namespace == W_NS and tag == "noBreakHyphen":
        return "-"
    if namespace == W_NS and tag == "softHyphen":
        return "\u00ad"
    if namespace == W_NS and tag == "sym":
        code = node.attrib.get(qn(W_NS, "char"), "")
        try:
            return chr(int(code, 16))
        except (TypeError, ValueError):
            return ""
    if namespace == M_NS and tag == "oMath":
        formula = clean_formula(math_to_latex(node))
        return f"${formula}$" if formula else ""
    if namespace == M_NS and tag == "oMathPara":
        formulas = [clean_formula(math_to_latex(child)) for child in node if local_name(child) == "oMath"]
        formula = r" \quad ".join(item for item in formulas if item)
        return f"\n$${formula}$$\n" if formula else ""
    if namespace == W_NS and tag in {"drawing", "pict", "object"}:
        return " [Hình minh họa] "
    return "".join(inline_text(child) for child in node)


def clean_formula(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    return value.replace("{ }", "{}")


def clean_text(value: str) -> str:
    value = value.replace("\r", "").replace("\u00a0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    value = re.sub(r" +([,.;:!?])", r"\1", value)
    return value.strip()


def style_map(archive: zipfile.ZipFile) -> dict[str, str]:
    try:
        root = ET.fromstring(archive.read("word/styles.xml"))
    except KeyError:
        return {}
    result: dict[str, str] = {}
    for style in root.iter(qn(W_NS, "style")):
        style_id = style.attrib.get(qn(W_NS, "styleId"), "")
        name = direct_child(style, "name")
        if style_id and name is not None:
            result[style_id] = node_value(name, style_id)
    return result


def paragraph_heading_level(paragraph: ET.Element, styles: dict[str, str]) -> int:
    ppr = direct_child(paragraph, "pPr")
    if ppr is None:
        return 0
    outline = direct_child(ppr, "outlineLvl")
    if outline is not None:
        try:
            return min(6, int(node_value(outline)) + 1)
        except ValueError:
            pass
    style_node = direct_child(ppr, "pStyle")
    style_id = node_value(style_node)
    style_name = styles.get(style_id, style_id)
    match = re.search(r"(?:heading|tiêu đề)\s*([1-6])", style_name, flags=re.IGNORECASE)
    return int(match.group(1)) if match else 0


def paragraph_text(paragraph: ET.Element, styles: dict[str, str]) -> str:
    text = clean_text("".join(inline_text(child) for child in paragraph if local_name(child) != "pPr"))
    if not text:
        return ""
    level = paragraph_heading_level(paragraph, styles)
    return f"{'#' * level} {text}" if level else text


def table_text(table: ET.Element, styles: dict[str, str]) -> str:
    rows: list[list[str]] = []
    for row in (item for item in table if local_name(item) == "tr"):
        cells: list[str] = []
        for cell in (item for item in row if local_name(item) == "tc"):
            paragraphs = [paragraph_text(item, styles) for item in cell.iter(qn(W_NS, "p"))]
            cells.append(clean_text(" ".join(item for item in paragraphs if item)).replace("|", r"\|"))
        if any(cells):
            rows.append(cells)
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(row) + " |" for row in normalized]
    if len(lines) > 1:
        lines.insert(1, "| " + " | ".join(["---"] * width) + " |")
    return "\n".join(lines)


def iter_body_blocks(node: ET.Element) -> Iterable[ET.Element]:
    for child in node:
        tag = local_name(child)
        if tag in {"p", "tbl"}:
            yield child
        elif tag in {"sdt", "sdtContent", "customXml", "ins"}:
            yield from iter_body_blocks(child)


def split_long_block(block: Block, limit: int = 1900) -> list[Block]:
    if len(block.text) <= limit:
        return [block]
    parts: list[Block] = []
    remaining = block.text
    while len(remaining) > limit:
        window = remaining[:limit]
        cut = max(window.rfind("\n"), window.rfind(". "), window.rfind("; "), window.rfind(" "))
        if cut < limit // 2:
            cut = limit
        parts.append(Block(clean_text(remaining[:cut]), block.kind, block.index))
        remaining = remaining[cut:].lstrip()
    if remaining:
        parts.append(Block(clean_text(remaining), block.kind, block.index))
    return [part for part in parts if part.text]


def chunk_blocks(blocks: list[Block], document_id: str, title: str) -> list[dict[str, object]]:
    pieces = [part for block in blocks for part in split_long_block(block)]
    chunks: list[dict[str, object]] = []
    cursor = 0
    target = 1650
    hard_limit = 2100
    while cursor < len(pieces):
        start_cursor = cursor
        selected: list[Block] = []
        size = 0
        while cursor < len(pieces):
            candidate = pieces[cursor]
            added = len(candidate.text) + (2 if selected else 0)
            if selected and size >= target and size + added > hard_limit:
                break
            if selected and size + added > hard_limit:
                break
            selected.append(candidate)
            size += added
            cursor += 1
            if size >= target:
                break
        if not selected:
            selected = [pieces[cursor]]
            cursor += 1
        text = "\n\n".join(item.text for item in selected).strip()
        chunk_index = len(chunks) + 1
        chunks.append(
            {
                "id": f"{document_id}-{chunk_index:03d}",
                "document_id": document_id,
                "document_title": title,
                "index": chunk_index,
                "start_block": selected[0].index,
                "end_block": selected[-1].index,
                "text": text,
            }
        )
        # One short paragraph of overlap improves retrieval across boundaries without
        # repeating large equations or tables in the index.
        if cursor < len(pieces) and len(selected[-1].text) <= 360 and cursor - 1 > start_cursor:
            cursor -= 1
    return chunks


def extract_document(path: Path, source: dict[str, str]) -> tuple[dict[str, object], list[dict[str, object]]]:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
        styles = style_map(archive)
    body = root.find(qn(W_NS, "body"))
    if body is None:
        raise ValueError(f"{path.name}: document.xml không có w:body")

    blocks: list[Block] = []
    paragraph_count = 0
    table_count = 0
    for element in iter_body_blocks(body):
        tag = local_name(element)
        if tag == "p":
            paragraph_count += 1
            text = paragraph_text(element, styles)
            kind = "paragraph"
        else:
            table_count += 1
            text = table_text(element, styles)
            kind = "table"
        if text:
            blocks.append(Block(text=text, kind=kind, index=paragraph_count + table_count))

    chunks = chunk_blocks(blocks, source["id"], source["title"])
    content = "\n\n".join(block.text for block in blocks)
    metadata: dict[str, object] = {
        "id": source["id"],
        "title": source["title"],
        "source_file": source["filename"],
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "paragraphs": paragraph_count,
        "tables": table_count,
        "math_objects": len(root.findall(f".//{{{M_NS}}}oMath")),
        "math_paragraphs": len(root.findall(f".//{{{M_NS}}}oMathPara")),
        "characters": len(content),
        "chunks": len(chunks),
    }
    return metadata, chunks


def build_payload() -> dict[str, object]:
    documents: list[dict[str, object]] = []
    chunks: list[dict[str, object]] = []
    for source in SOURCES:
        path = SOURCE_DIR / source["filename"]
        if not path.is_file():
            raise FileNotFoundError(f"Không tìm thấy nguồn kiến thức: {path}")
        metadata, document_chunks = extract_document(path, source)
        documents.append(metadata)
        chunks.extend(document_chunks)
    return {
        "schema_version": 1,
        "knowledge_id": "vector-ai.builtin-reference.v1",
        "language": "vi",
        "policy": "reference_only",
        "documents": documents,
        "chunks": chunks,
    }


def serialized_payload() -> str:
    return json.dumps(build_payload(), ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the committed index is missing or stale")
    args = parser.parse_args()

    rendered = serialized_payload()
    if args.check:
        if not OUTPUT_PATH.is_file():
            print(f"MISSING: {OUTPUT_PATH}", file=sys.stderr)
            return 1
        if OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            print("STALE: builtin-knowledge.json không khớp ba DOCX nguồn.", file=sys.stderr)
            return 1
        print(f"OK: {OUTPUT_PATH.relative_to(ROOT)} đã đồng bộ.")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    payload = json.loads(rendered)
    print(f"Wrote {OUTPUT_PATH}")
    print(f"Documents: {len(payload['documents'])} | Chunks: {len(payload['chunks'])}")
    for document in payload["documents"]:
        print(
            f"- {document['title']}: {document['characters']} chars, "
            f"{document['math_objects']} formulas, {document['chunks']} chunks"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
