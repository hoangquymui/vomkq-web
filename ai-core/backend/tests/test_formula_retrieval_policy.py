"""The retrieval gate: what a pending formula is allowed to hide.

Covers the pure policy, the ingestion extraction step that creates formula
records, and the startup recompute that repairs stores written earlier.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

from vector_ai_backend.adapters.symbolic import RestrictedSymbolicEngine
from vector_ai_backend.application.dataset_trees import DatasetTreeService
from vector_ai_backend.application.formula_policy import (
    appears_in_table_row,
    blocks_retrieval,
    is_plain_ratio,
    only_appears_in_table_rows,
)
from vector_ai_backend.application.ingestion import DocumentIngestionPipeline
from vector_ai_backend.bootstrap import build_container
from vector_ai_backend.config import BackendSettings
from vector_ai_backend.domain.models import (
    DocumentChunk,
    DocumentIngestionState,
    ExtractedFormula,
    ExtractedPage,
    FormulaRecord,
    VerificationMetadata,
    VerificationStatus,
)
from vector_ai_backend.formulas.validator import SafeFormulaValidator
from vector_ai_backend.storage.sqlite_repository import SQLiteKnowledgeRepository

RATIO = r"\frac{10W87}{570KT}"
REAL_FORMULA = r"\frac{a+b}{c}"
TABLE = "| Mã | Tỉ lệ |\n| --- | --- |\n| ALCM | $%s$ |" % RATIO
PROSE = f"Hệ số dùng trong tính toán là ${REAL_FORMULA}$ theo điều kiện chuẩn."


# --- the pure policy -------------------------------------------------------


def test_plain_ratio_in_a_table_row_never_blocks() -> None:
    assert not blocks_retrieval(
        status=VerificationStatus.NEEDS_REVIEW,
        latex=RATIO,
        chunk_text=TABLE,
    )


def test_plain_ratio_in_prose_never_blocks() -> None:
    assert not blocks_retrieval(
        status=VerificationStatus.NEEDS_REVIEW,
        latex=r"\frac{1.452}{250KT}",
        chunk_text=r"Tỉ lệ nhiên liệu $\frac{1.452}{250KT}$ của tên lửa.",
    )


def test_pending_real_formula_in_prose_blocks() -> None:
    assert blocks_retrieval(
        status=VerificationStatus.NEEDS_REVIEW,
        latex=REAL_FORMULA,
        chunk_text=PROSE,
    )


def test_reviewed_states_do_not_block() -> None:
    for status in (VerificationStatus.VERIFIED, VerificationStatus.REJECTED):
        assert not blocks_retrieval(status=status, latex=REAL_FORMULA, chunk_text=PROSE)
    assert not blocks_retrieval(status="VERIFIED", latex=REAL_FORMULA, chunk_text=PROSE)
    assert not blocks_retrieval(status="REJECTED", latex=REAL_FORMULA, chunk_text=PROSE)


def test_real_formula_in_a_table_row_does_not_block_its_chunk() -> None:
    table = f"| Đại lượng | Công thức |\n| --- | --- |\n| thời gian | ${REAL_FORMULA}$ |"
    assert blocks_retrieval(status=VerificationStatus.NEEDS_REVIEW, latex=REAL_FORMULA, chunk_text=PROSE)
    assert not blocks_retrieval(
        status=VerificationStatus.NEEDS_REVIEW, latex=REAL_FORMULA, chunk_text=table
    )


def test_formula_also_used_in_prose_still_blocks() -> None:
    mixed = f"{PROSE}\n\n| Đại lượng | Công thức |\n| --- | --- |\n| thời gian | ${REAL_FORMULA}$ |"
    assert appears_in_table_row(mixed, REAL_FORMULA)
    assert not only_appears_in_table_rows(mixed, REAL_FORMULA)
    assert blocks_retrieval(status=VerificationStatus.NEEDS_REVIEW, latex=REAL_FORMULA, chunk_text=mixed)


def test_is_plain_ratio_separates_data_from_claims() -> None:
    for latex in (RATIO, r"\frac{570KT}{10W87}", r"\frac{1.452}{250KT}", r"\frac{361}{66}",
                  r"\frac{ALCM}{CALCM}", r"\frac{100KT}{1 000}", r"$\frac{10W87}{570KT}$"):
        assert is_plain_ratio(latex), latex
    for latex in (REAL_FORMULA, r"\frac{x^{2}}{y}", r"\frac{v}{t}\cdot 2", r"\frac{\alpha}{\beta}",
                  r"s=v\cdot t", r"\frac{}{c}", r"\frac{ }{c}"):
        assert not is_plain_ratio(latex), latex


def test_table_row_detection_needs_a_real_pipe_row() -> None:
    assert appears_in_table_row(TABLE, RATIO)
    assert not appears_in_table_row(f"Đoạn văn có ${RATIO}$ ở giữa.", RATIO)
    assert not appears_in_table_row(TABLE, r"\frac{1}{2}")
    assert only_appears_in_table_rows(TABLE, RATIO)


# --- ingestion extraction --------------------------------------------------


def _pipeline(repository: SQLiteKnowledgeRepository, work_dir: Path) -> DocumentIngestionPipeline:
    return DocumentIngestionPipeline(
        repository=repository,
        extractor=None,
        ocr=None,
        validator=SafeFormulaValidator(symbolic_engine=RestrictedSymbolicEngine()),
        profile_catalog=None,
        embeddings=None,
        vectors=None,
        scheduler=None,
        checkpoints=None,
        work_dir=work_dir,
        default_profile_id="test",
    )


def test_validate_skips_table_ratios_and_keeps_real_formulas(tmp_path: Path) -> None:
    async def scenario() -> list[FormulaRecord]:
        repository = SQLiteKnowledgeRepository(tmp_path / "validate.sqlite3")
        try:
            await repository.upsert_document({"id": "manual", "title": "Sổ tay", "version": 1})
            await repository.upsert_chunks([DocumentChunk("chunk-source", "manual", 1, "Nội dung gốc", 0)])
            service = DatasetTreeService(repository)
            tree = (await service.get("manual", 1))["tree"]
            tree["nodes"].append({
                "id": "ratios", "parent_id": "root", "title": "Bảng tỉ lệ", "kind": "table",
                "description": "", "chunk_id": None, "collapsed": False, "content": TABLE,
            })
            tree["nodes"].append({
                "id": "claim", "parent_id": "root", "title": "Kết luận", "kind": "formula",
                "description": "", "chunk_id": None, "collapsed": False, "content": PROSE,
            })
            await service.update("manual", 1, tree)

            pages_path = tmp_path / "pages.json"
            pages_path.write_text(json.dumps([asdict(ExtractedPage(
                page=1,
                text=f"| Mã | Tỉ lệ |\n| --- | --- |\n| ALCM | $\\frac{{1.452}}{{250KT}}$ |\n\n{PROSE}",
                formulas=[
                    ExtractedFormula(latex=r"\frac{1.452}{250KT}", confidence=1.0, source={"method": "native-text"}),
                    ExtractedFormula(latex=REAL_FORMULA, confidence=1.0, source={"method": "native-text"}),
                ],
            ))], ensure_ascii=False), encoding="utf-8")

            async def emit(event: object) -> None:
                return None

            pipeline = _pipeline(repository, tmp_path / "work")
            await pipeline.validate(
                DocumentIngestionState(
                    "run-1", "manual", 1, checkpoint={"pages_path": str(pages_path)}
                ),
                emit,
                asyncio.Event(),
            )
            return await repository.list_formulas(document_id="manual", limit=100)
        finally:
            await repository.close()

    formulas = asyncio.run(scenario())
    latexes = {formula.raw_latex for formula in formulas}
    assert REAL_FORMULA in latexes
    assert not any(is_plain_ratio(latex) for latex in latexes)
    pending = [formula for formula in formulas if formula.raw_latex == REAL_FORMULA]
    assert all(formula.verification.status is VerificationStatus.NEEDS_REVIEW for formula in pending)


# --- repairing stores written earlier --------------------------------------


def _ratio_formula(*, status: VerificationStatus, chunk_id: str) -> FormulaRecord:
    return FormulaRecord(
        id="formula-ratio", version=1, document_id="manual", document_version=1,
        name=None, aliases=[], raw_latex=RATIO, normalized_latex=RATIO, sympy_expression=None,
        variables={}, units={}, conditions=[], assumptions=[], source={"page": 1},
        verification=VerificationMetadata(status=status), chunk_ids=[chunk_id],
    )


def _seed_store(path: Path) -> None:
    async def scenario() -> None:
        repository = SQLiteKnowledgeRepository(path)
        try:
            await repository.upsert_document({"id": "manual", "title": "Sổ tay", "version": 1})
            await repository.upsert_chunks([
                DocumentChunk("chunk-table", "manual", 1, TABLE, 0),
                DocumentChunk("chunk-prose", "manual", 1, PROSE, 1),
            ])
            await repository.upsert_formula(_ratio_formula(status=VerificationStatus.NEEDS_REVIEW, chunk_id="chunk-table"))
            await repository.upsert_formula(FormulaRecord(
                id="formula-real", version=1, document_id="manual", document_version=1,
                name=None, aliases=[], raw_latex=REAL_FORMULA, normalized_latex=REAL_FORMULA,
                sympy_expression=None, variables={}, units={}, conditions=[], assumptions=[],
                source={"page": 1}, verification=VerificationMetadata(status=VerificationStatus.NEEDS_REVIEW),
                chunk_ids=["chunk-prose"],
            ))
        finally:
            await repository.close()
    asyncio.run(scenario())


def _force_legacy_flags(path: Path) -> None:
    """Write what the previous release stored: both chunks held back."""
    connection = sqlite3.connect(path)
    try:
        connection.execute("UPDATE document_chunks SET retrieval_eligible=0")
        connection.commit()
    finally:
        connection.close()


def test_repository_recompute_recovers_legacy_flags(tmp_path: Path) -> None:
    path = tmp_path / "gate.sqlite3"
    _seed_store(path)
    _force_legacy_flags(path)

    async def scenario() -> tuple[list[str], int, int, list[str]]:
        repository = SQLiteKnowledgeRepository(path)
        try:
            before = [chunk.id for chunk in await repository.list_retrieval_chunks()]
            changed = await repository.recompute_retrieval_eligibility()
            again = await repository.recompute_retrieval_eligibility()
            after = [chunk.id for chunk in await repository.list_retrieval_chunks()]
            return before, changed, again, after
        finally:
            await repository.close()

    before, changed, again, after = asyncio.run(scenario())
    assert before == []  # the legacy store held both chunks back
    assert changed == 1 and again == 0  # idempotent: nothing left to repair
    assert after == ["chunk-table"]  # the prose formula still gates its own chunk


def test_container_startup_repairs_an_existing_document(tmp_path: Path) -> None:
    path = tmp_path / "vector_ai.sqlite3"
    _seed_store(path)
    _force_legacy_flags(path)

    settings = BackendSettings(data_dir=tmp_path, resource_ram_mb=2048, chat_ram_mb=512)
    container = asyncio.run(build_container(settings))
    try:
        chunks = asyncio.run(container.repository.list_retrieval_chunks())
    finally:
        asyncio.run(container.close())
    stored = {chunk.id: chunk.text for chunk in chunks}
    assert "chunk-table" in stored and stored["chunk-table"] == TABLE
    assert "chunk-prose" not in stored  # a pending real formula still gates its chunk
