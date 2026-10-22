from vector_ai_backend.adapters.document_extraction import OfflineDocumentExtractor
from vector_ai_backend.application.ingestion import StructuralChunker
from vector_ai_backend.domain.models import ExtractedPage


def test_manual_markdown_keeps_table_math_and_headers(tmp_path):
    text = "# Tài liệu thủ công\n\nMô tả.\n\n| Đại lượng | Công thức |\n| --- | --- |\n| s | $s=v*t$ |\n| t | $t=s/v$ |\n\nGhi chú cuối."
    path = tmp_path / "manual.md"
    path.write_text(text, encoding="utf-8")
    pages = OfflineDocumentExtractor(tmp_path / "extract")._extract_native(path)
    chunks = StructuralChunker().split(pages)
    assert len(pages[0].formulas) == 2
    assert any("| s | $s=v*t$ |\n| t | $t=s/v$ |" in c["text"] for c in chunks)
    assert "Ghi chú cuối." in "\n".join(c["text"] for c in chunks)


def test_long_tables_split_only_at_rows_repeat_header_without_data_loss():
    header = "| Tên | Giá trị |\n| --- | --- |"
    rows = [f"| dòng-{i} | $x_{i}=2$ |" for i in range(30)]
    chunks = StructuralChunker(target_tokens=45, overlap_tokens=0).split([
        ExtractedPage(page=3, text=header + "\n" + "\n".join(rows))
    ])
    assert len(chunks) > 1
    restored = []
    for chunk in chunks:
        assert chunk["page"] == 3
        assert chunk["text"].startswith(header)
        restored.extend(chunk["text"].splitlines()[2:])
    assert restored == rows


def test_multiline_cell_breaks_and_stacked_fraction_survive_ingestion(tmp_path):
    row = r"| Dòng đầu<br>$\frac{10w}{57kt}$<br>Dòng cuối | Ghi chú |"
    text = "# Bảng nhiều dòng\n\n| Nội dung | Mô tả |\n| --- | --- |\n" + row
    path = tmp_path / "multiline.md"
    path.write_text(text, encoding="utf-8")
    pages = OfflineDocumentExtractor(tmp_path / "extract")._extract_native(path)
    chunks = StructuralChunker(target_tokens=25, overlap_tokens=0).split(pages)
    assert len(pages[0].formulas) == 1
    assert any(row in chunk["text"] for chunk in chunks)


def test_oversized_row_and_formula_preserved_not_truncated():
    row = "| " + "nội dung " * 100 + "| $x=\\frac{a}{b}$ |"
    formula = "$$x=\\frac{a}{b}$$"
    page = ExtractedPage(page=1, text=f"{formula}\n\n| A | B |\n| --- | --- |\n{row}\n")
    chunks = StructuralChunker(target_tokens=25, overlap_tokens=0).split([page])
    assert any(row in c["text"] for c in chunks)
    assert any(formula in c["text"] for c in chunks)


def test_merged_cell_markers_read_as_the_content_they_cover():
    prose = "Ghi chú ^^ và << ngoài bảng."
    table = "| Tên | Giá trị |\n| --- | --- |\n| Khối | << |\n| ^^ | << |"
    chunks = StructuralChunker(target_tokens=64, overlap_tokens=0).split([
        ExtractedPage(page=2, text=f"{prose}\n\n{table}\n")
    ])
    text = "\n".join(chunk["text"] for chunk in chunks)
    assert prose in text  # Prose keeps its own markers; only table units are rewritten.
    assert "\n".join(line for line in text.splitlines() if line.startswith("|")) == (
        "| Tên | Giá trị |\n| --- | --- |\n| Khối | Khối |\n| Khối | Khối |"
    )
