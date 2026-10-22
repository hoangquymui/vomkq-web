from __future__ import annotations

import asyncio

from vector_ai_backend.adapters.symbolic import RestrictedSymbolicEngine
from vector_ai_backend.domain.models import (
    CheckStatus,
    FormulaRecord,
    VerificationMetadata,
    VerificationStatus,
)
from vector_ai_backend.formulas.semantic import formula_semantic_representation
from vector_ai_backend.formulas.validator import SafeFormulaValidator


def formula(expression: str, *, variables=None, units=None, conditions=None, confidence=0.99) -> FormulaRecord:
    return FormulaRecord(
        id="f1", version=1, document_id="d1", document_version=1,
        name="Vận tốc", aliases=["tốc độ"], raw_latex=expression,
        normalized_latex=expression, sympy_expression=expression,
        variables=variables or {}, units=units or {}, conditions=conditions or [], assumptions=[],
        source={"title": "Nguồn thử"}, verification=VerificationMetadata(confidence=confidence),
    )


def test_semantic_representation_has_stable_order_and_no_invented_fields() -> None:
    value = formula_semantic_representation(formula("v=s/t", variables={"v": "vận tốc", "s": "quãng đường", "t": "thời gian"}, units={"v": "m/s", "s": "m", "t": "s"}))
    positions = [value.index(label) for label in ("Tên công thức", "Biểu thức chuẩn hóa", "Biến", "Đơn vị", "Tên gọi khác", "Ngữ cảnh nguồn")]
    assert positions == sorted(positions)
    assert "Điều kiện:" not in value and "Giả thiết:" not in value


def test_validator_separates_syntax_math_and_reference_equivalence() -> None:
    async def scenario() -> None:
        validator = SafeFormulaValidator(symbolic_engine=RestrictedSymbolicEngine())
        candidate = formula("v=s/t", variables={"v": "vận tốc", "s": "quãng đường", "t": "thời gian"}, units={"v": "m/s", "s": "m", "t": "s"}, conditions=["t != 0"])
        report = await validator.validate(candidate)
        assert all(check.category == "syntax" for check in report.syntax_checks)
        equivalence = next(check for check in report.mathematical_checks if check.name == "symbolic_equivalence")
        assert equivalence.status is CheckStatus.NOT_APPLICABLE
        assert report.recommended_status is VerificationStatus.VERIFIED

        missing = formula("v=s/t", variables={"v": "vận tốc"}, units={"v": "m/s"})
        missing_report = await validator.validate(missing)
        symbols = next(check for check in missing_report.mathematical_checks if check.name == "symbol_binding")
        domain = next(check for check in missing_report.mathematical_checks if check.name == "domain_constraints")
        assert symbols.status is CheckStatus.UNKNOWN
        assert domain.status is CheckStatus.UNKNOWN
        assert missing_report.recommended_status is VerificationStatus.NEEDS_REVIEW

        reference = formula("s/t=v", variables=candidate.variables, units=candidate.units, conditions=["t != 0"])
        equivalent_report = await validator.validate(candidate, reference=reference)
        equivalent = next(check for check in equivalent_report.mathematical_checks if check.name == "symbolic_equivalence")
        assert equivalent.status is CheckStatus.PASS
    asyncio.run(scenario())
