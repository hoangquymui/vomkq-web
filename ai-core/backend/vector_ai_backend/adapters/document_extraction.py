from __future__ import annotations

import asyncio
import importlib.util
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import asdict
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from ..domain.models import ExtractedFormula, ExtractedPage


FORMULA_PATTERN = re.compile(
    r"\$\$(.+?)\$\$|\\\[(.+?)\\\]|(?<!\$)\$([^\n$]+?)\$(?!\$)|\\\((.+?)\\\)",
    re.DOTALL,
)


class OfflineDocumentExtractor:
    """Extract local files without network calls; OCR adapters are optional."""

    TEXT_EXTENSIONS = {
        ".txt", ".md", ".json", ".jsonl", ".csv", ".log", ".xml", ".yaml", ".yml",
        ".py", ".js", ".ts", ".html", ".css", ".rs",
    }

    def __init__(self, work_dir: Path) -> None:
        self.work_dir = work_dir
        self.work_dir.mkdir(parents=True, exist_ok=True)

    async def extract_native(self, path: Path) -> list[ExtractedPage]:
        return await asyncio.to_thread(self._extract_native, path)

    def _extract_native(self, path: Path) -> list[ExtractedPage]:
        suffix = path.suffix.casefold()
        if suffix in self.TEXT_EXTENSIONS:
            text = path.read_text(encoding="utf-8", errors="replace")
            return [self._page(1, text)]
        if suffix == ".docx":
            return [self._page(1, self._extract_docx(path))]
        if suffix == ".pdf":
            return self._extract_pdf(path)
        if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
            return [ExtractedPage(page=1, text="", image_paths=[str(path)])]
        raise ValueError(f"Định dạng tài liệu chưa được hỗ trợ: {suffix or '(không có đuôi)'}")

    @staticmethod
    def _page(number: int, text: str, *, images: list[str] | None = None) -> ExtractedPage:
        formulas = [
            ExtractedFormula(
                latex=next(value for value in match.groups() if value is not None).strip(),
                confidence=1.0,
                source={"page": number, "method": "native-text"},
            )
            for match in FORMULA_PATTERN.finditer(text)
        ]
        return ExtractedPage(page=number, text=text.strip(), image_paths=images or [], formulas=formulas)

    @staticmethod
    def _extract_docx(path: Path) -> str:
        # Reuse the project's deterministic OMML parser when present.
        project_root = Path(__file__).resolve().parents[3]
        builder = project_root / "scripts" / "build_builtin_knowledge.py"
        if builder.is_file():
            spec = importlib.util.spec_from_file_location("vector_ai_builtin_extractor", builder)
            if spec and spec.loader:
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                source = {"id": path.stem, "title": path.stem, "filename": path.name}
                _, chunks = module.extract_document(path, source)
                return "\n\n".join(str(chunk["text"]) for chunk in chunks)
        with zipfile.ZipFile(path) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
        texts: list[str] = []
        for node in root.iter():
            if node.tag.rsplit("}", 1)[-1] == "t" and node.text:
                texts.append(node.text)
        return " ".join(texts)

    def _extract_pdf(self, path: Path) -> list[ExtractedPage]:
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("Cần cài extra documents để đọc PDF.") from exc
        reader = PdfReader(str(path))
        pages: list[ExtractedPage] = []
        for index, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            images: list[str] = []
            if not text:
                rendered = self._render_pdf_page(path, index - 1)
                if rendered:
                    images.append(str(rendered))
            pages.append(self._page(index, text, images=images))
        return pages

    def _render_pdf_page(self, path: Path, page_index: int) -> Path | None:
        try:
            import fitz
        except ImportError:
            return None
        output = self.work_dir / f"page-{page_index + 1:05d}.png"
        with fitz.open(path) as document:
            page = document.load_page(page_index)
            page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(output)
        return output


class OfflineOCREngine:
    """Tesseract text OCR plus optional Pix2Text formula recognition."""

    def __init__(self, languages: str = "vie+rus+eng") -> None:
        self.languages = languages
        self._pix2text: Any | None = None

    def status(self) -> dict[str, Any]:
        return {
            "tesseract": bool(shutil.which("tesseract")),
            "pix2text": importlib.util.find_spec("pix2text") is not None,
            "languages": self.languages,
        }

    async def recognize(self, image_path: Path) -> tuple[str, list[ExtractedFormula]]:
        return await asyncio.to_thread(self._recognize, image_path)

    def _recognize(self, image_path: Path) -> tuple[str, list[ExtractedFormula]]:
        executable = shutil.which("tesseract")
        if not executable:
            raise RuntimeError("Tesseract chưa được cài hoặc chưa có trong PATH.")
        process = subprocess.run(
            [executable, str(image_path), "stdout", "-l", self.languages],
            capture_output=True,
            check=False,
            timeout=120,
        )
        if process.returncode:
            detail = process.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(f"Tesseract thất bại: {detail[-1000:]}")
        text = process.stdout.decode("utf-8", errors="replace").strip()
        return text, self._recognize_formulas(image_path)

    def _recognize_formulas(self, image_path: Path) -> list[ExtractedFormula]:
        try:
            from pix2text import Pix2Text
        except ImportError:
            return []
        if self._pix2text is None:
            # Pix2Text resolves only already-prepared local assets in the offline environment.
            self._pix2text = Pix2Text.from_config()
        output = self._pix2text.recognize(str(image_path))
        rows = output if isinstance(output, list) else [output]
        formulas: list[ExtractedFormula] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            kind = str(row.get("type", row.get("category", ""))).casefold()
            value = row.get("text", row.get("latex", ""))
            if value and ("formula" in kind or "latex" in row):
                score = row.get("score", row.get("confidence"))
                formulas.append(
                    ExtractedFormula(
                        latex=str(value).strip("$ "),
                        confidence=float(score) if score is not None else None,
                        source={"method": "pix2text", "position": row.get("position")},
                    )
                )
        return formulas


def save_pages(path: Path, pages: list[ExtractedPage]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([asdict(page) for page in pages], ensure_ascii=False), encoding="utf-8")


def load_pages(path: Path) -> list[ExtractedPage]:
    values = json.loads(path.read_text(encoding="utf-8"))
    return [
        ExtractedPage(
            page=int(item["page"]),
            text=str(item.get("text", "")),
            image_paths=list(item.get("image_paths", [])),
            formulas=[ExtractedFormula(**formula) for formula in item.get("formulas", [])],
        )
        for item in values
    ]
