"""Conservative formula validation with separate syntax and math reports."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

import sympy as sp

from vector_ai_backend.domain.models import (
    CheckStatus,
    FormulaCheckResult,
    FormulaRecord,
    FormulaValidationReport,
    VerificationMethod,
    VerificationStatus,
)
from vector_ai_backend.domain.ports import SymbolicEngine

from .safe_sympy import SafeExpressionError, SafeSympyParser, expression_difference


VALIDATOR_VERSION = "formula-validator-v1"


@dataclass(frozen=True, slots=True)
class _Dimension:
    values: tuple[Fraction, Fraction, Fraction, Fraction, Fraction, Fraction, Fraction]

    def __mul__(self, other: _Dimension) -> _Dimension:
        return _Dimension(tuple(a + b for a, b in zip(self.values, other.values, strict=True)))

    def __truediv__(self, other: _Dimension) -> _Dimension:
        return _Dimension(tuple(a - b for a, b in zip(self.values, other.values, strict=True)))

    def __pow__(self, exponent: Fraction) -> _Dimension:
        return _Dimension(tuple(value * exponent for value in self.values))


_ZERO_DIM = _Dimension((Fraction(0),) * 7)


def _dim(*values: int) -> _Dimension:
    padded = tuple(Fraction(value) for value in values) + (Fraction(0),) * (7 - len(values))
    return _Dimension(padded)  # type: ignore[arg-type]


_BASE_UNITS: dict[str, _Dimension] = {
    "1": _ZERO_DIM,
    "m": _dim(1),
    "cm": _dim(1),
    "mm": _dim(1),
    "km": _dim(1),
    "s": _dim(0, 1),
    "ms": _dim(0, 1),
    "h": _dim(0, 1),
    "kg": _dim(0, 0, 1),
    "g": _dim(0, 0, 1),
    "A": _dim(0, 0, 0, 1),
    "K": _dim(0, 0, 0, 0, 1),
    "mol": _dim(0, 0, 0, 0, 0, 1),
    "cd": _dim(0, 0, 0, 0, 0, 0, 1),
    "Hz": _dim(0, -1),
    "N": _dim(1, -2, 1),
    "Pa": _dim(-1, -2, 1),
    "J": _dim(2, -2, 1),
    "W": _dim(2, -3, 1),
    "rad": _ZERO_DIM,
    "deg": _ZERO_DIM,
}


class _UnknownDimension(Exception):
    pass


class _DimensionMismatch(Exception):
    pass


class SafeFormulaValidator:
    """Validate formulas without treating successful parsing as mathematical proof."""

    def __init__(
        self,
        *,
        parser: SafeSympyParser | None = None,
        symbolic_engine: SymbolicEngine | None = None,
        auto_verify_confidence: float = 0.98,
    ) -> None:
        if not 0.0 <= auto_verify_confidence <= 1.0:
            raise ValueError("auto_verify_confidence must be between 0 and 1")
        self.parser = parser or SafeSympyParser()
        self.symbolic_engine = symbolic_engine
        self.auto_verify_confidence = auto_verify_confidence

    async def validate(
        self,
        formula: FormulaRecord,
        *,
        reference: FormulaRecord | None = None,
    ) -> FormulaValidationReport:
        bracket_check = self._check_brackets(formula.raw_latex or formula.normalized_latex)
        parsed: sp.Basic | None = None
        parse_check: FormulaCheckResult
        try:
            source = formula.sympy_expression or formula.normalized_latex
            parsed_result = self.parser.parse(source)
            parsed = parsed_result.expression
            parse_check = self._check(
                "restricted_parse",
                "syntax",
                CheckStatus.PASS,
                "Biểu thức được phân tích đầy đủ bằng grammar giới hạn.",
                safe_text=parsed_result.safe_text,
            )
        except SafeExpressionError as exc:
            parse_check = self._check(
                "restricted_parse",
                "syntax",
                CheckStatus.FAIL,
                str(exc),
            )

        syntax_checks = (bracket_check, parse_check)
        if parsed is None:
            mathematical_checks = (
                self._check("symbol_binding", "mathematical", CheckStatus.UNKNOWN, "Không thể kiểm tra vì cú pháp chưa hợp lệ."),
                self._check("unit_consistency", "mathematical", CheckStatus.UNKNOWN, "Không thể kiểm tra vì cú pháp chưa hợp lệ."),
                self._check("domain_constraints", "mathematical", CheckStatus.UNKNOWN, "Không thể kiểm tra vì cú pháp chưa hợp lệ."),
                self._check("assumptions", "mathematical", CheckStatus.UNKNOWN, "Không thể kiểm tra vì cú pháp chưa hợp lệ."),
                self._check(
                    "symbolic_equivalence",
                    "mathematical",
                    CheckStatus.NOT_APPLICABLE if reference is None else CheckStatus.UNKNOWN,
                    "Không có công thức tham chiếu." if reference is None else "Không thể so sánh vì cú pháp chưa hợp lệ.",
                ),
            )
        else:
            mathematical_checks = (
                self._check_symbols(parsed, formula.variables),
                self._check_units(parsed, formula.units),
                self._check_domain(parsed, formula.conditions, formula.assumptions),
                self._check_assumptions(parsed, formula.assumptions),
                await self._check_equivalence(formula, parsed, reference),
            )

        recommended = self._recommend_status(formula, syntax_checks, mathematical_checks)
        return FormulaValidationReport(
            formula_id=formula.id,
            syntax_checks=syntax_checks,
            mathematical_checks=mathematical_checks,
            recommended_status=recommended,
            validator_version=VALIDATOR_VERSION,
        )

    @staticmethod
    def _check(
        name: str,
        category: str,
        status: CheckStatus,
        message: str,
        **details: Any,
    ) -> FormulaCheckResult:
        return FormulaCheckResult(
            name=name,
            category=category,
            status=status,
            message=message,
            details=details,
        )

    def _check_brackets(self, value: str) -> FormulaCheckResult:
        pairs = {"}": "{", ")": "(", "]": "["}
        stack: list[tuple[str, int]] = []
        escaped = False
        for index, char in enumerate(value):
            if escaped:
                escaped = False
                continue
            if char == "\\":
                escaped = True
                continue
            if char in "{([":
                stack.append((char, index))
            elif char in "})]":
                if not stack or stack[-1][0] != pairs[char]:
                    return self._check(
                        "balanced_delimiters", "syntax", CheckStatus.FAIL, f"Ngoặc không cân bằng tại vị trí {index}."
                    )
                stack.pop()
        if stack:
            return self._check(
                "balanced_delimiters",
                "syntax",
                CheckStatus.FAIL,
                f"Ngoặc mở tại vị trí {stack[-1][1]} chưa được đóng.",
            )
        return self._check("balanced_delimiters", "syntax", CheckStatus.PASS, "Các cặp ngoặc cân bằng.")

    def _check_symbols(self, expression: sp.Basic, variables: Mapping[str, str]) -> FormulaCheckResult:
        symbols = sorted(str(symbol) for symbol in expression.free_symbols)
        declared = set(variables)
        missing = sorted(set(symbols) - declared)
        unused = sorted(declared - set(symbols))
        if missing:
            return self._check(
                "symbol_binding",
                "mathematical",
                CheckStatus.UNKNOWN,
                "Có ký hiệu chưa được mô tả.",
                symbols=symbols,
                missing=missing,
                unused=unused,
            )
        return self._check(
            "symbol_binding",
            "mathematical",
            CheckStatus.PASS,
            "Tất cả ký hiệu đều có khai báo." if symbols else "Biểu thức không có biến tự do.",
            symbols=symbols,
            unused=unused,
        )

    def _check_units(self, expression: sp.Basic, units: Mapping[str, str]) -> FormulaCheckResult:
        symbols = {str(symbol) for symbol in expression.free_symbols}
        if not units:
            return self._check(
                "unit_consistency", "mathematical", CheckStatus.NOT_APPLICABLE, "Không có metadata đơn vị để kiểm tra."
            )
        missing = sorted(symbols - set(units))
        if missing:
            return self._check(
                "unit_consistency",
                "mathematical",
                CheckStatus.UNKNOWN,
                "Thiếu đơn vị của một số ký hiệu.",
                missing=missing,
            )
        try:
            dimensions = {name: self._parse_unit(unit) for name, unit in units.items() if name in symbols}
            self._dimension_of(expression, dimensions)
        except _UnknownDimension as exc:
            return self._check("unit_consistency", "mathematical", CheckStatus.UNKNOWN, str(exc))
        except _DimensionMismatch as exc:
            return self._check("unit_consistency", "mathematical", CheckStatus.FAIL, str(exc))
        return self._check("unit_consistency", "mathematical", CheckStatus.PASS, "Phương trình đồng nhất thứ nguyên.")

    def _parse_unit(self, unit: str) -> _Dimension:
        value = (
            unit.strip()
            .replace("²", "^2")
            .replace("³", "^3")
            .replace("⁻", "-")
            .replace("·", "*")
            .replace(" ", "*")
        )
        if value in ("", "-", "none", "dimensionless"):
            return _ZERO_DIM
        try:
            parsed = self.parser.parse(value).expression
        except SafeExpressionError as exc:
            raise _UnknownDimension(f"Không phân tích được đơn vị {unit!r}: {exc}") from exc
        return self._dimension_of(parsed, _BASE_UNITS)

    def _dimension_of(self, expression: sp.Basic, symbols: Mapping[str, _Dimension]) -> _Dimension:
        if expression.is_Number:
            return _ZERO_DIM
        if expression.is_Symbol:
            name = str(expression)
            if name not in symbols:
                raise _UnknownDimension(f"Đơn vị hoặc ký hiệu chưa hỗ trợ: {name}")
            return symbols[name]
        if isinstance(expression, sp.Equality):
            left = self._dimension_of(expression.lhs, symbols)
            right = self._dimension_of(expression.rhs, symbols)
            if left != right:
                raise _DimensionMismatch("Hai vế phương trình không cùng thứ nguyên.")
            return left
        if expression.is_Add:
            values = [self._dimension_of(argument, symbols) for argument in expression.args]
            if any(value != values[0] for value in values[1:]):
                raise _DimensionMismatch("Các hạng tử cộng/trừ không cùng thứ nguyên.")
            return values[0]
        if expression.is_Mul:
            result = _ZERO_DIM
            for argument in expression.args:
                result *= self._dimension_of(argument, symbols)
            return result
        if expression.is_Pow:
            base, exponent = expression.args
            if not exponent.is_number:
                raise _UnknownDimension("Số mũ có biến nên chưa thể kiểm tra thứ nguyên.")
            exponent_value = Fraction(str(exponent))
            return self._dimension_of(base, symbols) ** exponent_value
        if expression.func in (sp.sin, sp.cos, sp.tan, sp.asin, sp.acos, sp.atan, sp.exp, sp.log):
            argument_dimension = self._dimension_of(expression.args[0], symbols)
            if argument_dimension != _ZERO_DIM:
                raise _DimensionMismatch("Đối số của hàm lượng giác/mũ/log phải không thứ nguyên.")
            return _ZERO_DIM
        if expression.func is sp.Abs:
            return self._dimension_of(expression.args[0], symbols)
        raise _UnknownDimension(f"Chưa hỗ trợ kiểm tra thứ nguyên cho {expression.func}.")

    def _check_domain(
        self,
        expression: sp.Basic,
        conditions: Sequence[str],
        assumptions: Sequence[str],
    ) -> FormulaCheckResult:
        target = expression_difference(expression)
        inferred: list[tuple[str, str]] = []
        denominator = sp.denom(sp.together(target))
        if denominator != 1:
            inferred.append((str(denominator), "nonzero"))
        for node in sp.preorder_traversal(target):
            if node.func is sp.log:
                inferred.append((str(node.args[0]), "positive"))
            elif node.is_Pow and len(node.args) == 2:
                exponent = node.args[1]
                if exponent.is_Rational and int(exponent.q) % 2 == 0:
                    inferred.append((str(node.args[0]), "nonnegative"))
        inferred = list(dict.fromkeys(inferred))
        if not inferred:
            return self._check(
                "domain_constraints", "mathematical", CheckStatus.PASS, "Không phát hiện ràng buộc miền bắt buộc."
            )
        declared = [*conditions, *assumptions]
        uncovered = [f"{value}:{kind}" for value, kind in inferred if not self._constraint_is_declared(value, kind, declared)]
        if uncovered:
            return self._check(
                "domain_constraints",
                "mathematical",
                CheckStatus.UNKNOWN,
                "Ràng buộc miền suy ra chưa được xác nhận trong metadata nguồn.",
                inferred=[f"{value}:{kind}" for value, kind in inferred],
                uncovered=uncovered,
            )
        return self._check(
            "domain_constraints",
            "mathematical",
            CheckStatus.PASS,
            "Các ràng buộc miền suy ra đều được khai báo.",
            inferred=[f"{value}:{kind}" for value, kind in inferred],
        )

    @staticmethod
    def _constraint_is_declared(value: str, kind: str, declared: Sequence[str]) -> bool:
        names = {str(symbol) for symbol in SafeSympyParser().parse(value).expression.free_symbols}
        for statement in declared:
            compact = statement.replace(" ", "").lower()
            if names and not all(name.lower() in compact for name in names):
                continue
            if kind == "nonzero" and any(marker in compact for marker in ("!=0", "≠0", "khác0", "nonzero")):
                return True
            if kind == "positive" and any(marker in compact for marker in (">0", "dương", "positive")):
                return True
            if kind == "nonnegative" and any(marker in compact for marker in (">=0", "≥0", "khôngâm", "nonnegative")):
                return True
        return False

    def _check_assumptions(self, expression: sp.Basic, assumptions: Sequence[str]) -> FormulaCheckResult:
        if not assumptions:
            return self._check(
                "assumptions", "mathematical", CheckStatus.NOT_APPLICABLE, "Nguồn không khai báo giả thiết bổ sung."
            )
        symbols = {str(symbol) for symbol in expression.free_symbols}
        unrelated = [value for value in assumptions if symbols and not any(symbol in value for symbol in symbols)]
        if unrelated:
            return self._check(
                "assumptions",
                "mathematical",
                CheckStatus.UNKNOWN,
                "Một số giả thiết không liên kết rõ với ký hiệu trong công thức.",
                source_assumptions=list(assumptions),
                unrelated=unrelated,
            )
        return self._check(
            "assumptions",
            "mathematical",
            CheckStatus.PASS,
            "Đã ghi nhận riêng các giả thiết do nguồn khai báo.",
            source_assumptions=list(assumptions),
        )

    async def _check_equivalence(
        self,
        formula: FormulaRecord,
        parsed: sp.Basic,
        reference: FormulaRecord | None,
    ) -> FormulaCheckResult:
        if reference is None:
            return self._check(
                "symbolic_equivalence",
                "mathematical",
                CheckStatus.NOT_APPLICABLE,
                "Không có công thức tham chiếu.",
            )
        reference_source = reference.sympy_expression or reference.normalized_latex
        try:
            reference_parsed = self.parser.parse(reference_source).expression
        except SafeExpressionError as exc:
            return self._check(
                "symbolic_equivalence",
                "mathematical",
                CheckStatus.UNKNOWN,
                f"Công thức tham chiếu không phân tích được: {exc}",
            )
        try:
            if self.symbolic_engine is not None:
                result = await self.symbolic_engine.equivalent(
                    formula.sympy_expression or self.parser.normalize_input(formula.normalized_latex),
                    reference.sympy_expression or self.parser.normalize_input(reference.normalized_latex),
                    [*formula.assumptions, *reference.assumptions],
                )
            else:
                result = self._equivalent_locally(parsed, reference_parsed)
        except Exception as exc:  # adapter timeout/unsupported is not a proof of failure
            return self._check(
                "symbolic_equivalence", "mathematical", CheckStatus.UNKNOWN, f"Không hoàn tất so sánh ký hiệu: {exc}"
            )
        if result is None:
            return self._check(
                "symbolic_equivalence",
                "mathematical",
                CheckStatus.UNKNOWN,
                "Bộ máy ký hiệu không thể kết luận tương đương.",
            )
        return self._check(
            "symbolic_equivalence",
            "mathematical",
            CheckStatus.PASS if result else CheckStatus.FAIL,
            "Tương đương ký hiệu trong phạm vi giả thiết đã khai báo."
            if result
            else "Không tương đương ký hiệu với công thức tham chiếu.",
        )

    @staticmethod
    def _equivalent_locally(left: sp.Basic, right: sp.Basic) -> bool | None:
        left_value = expression_difference(left)
        right_value = expression_difference(right)
        if isinstance(left, sp.Equality) != isinstance(right, sp.Equality):
            return False
        if isinstance(left, sp.Equality):
            if sp.simplify(left_value - right_value) == 0:
                return True
            if right_value == 0:
                return left_value == 0
            ratio = sp.simplify(left_value / right_value)
            return bool(ratio != 0 and not ratio.free_symbols)
        return bool(sp.simplify(left_value - right_value) == 0)

    def _recommend_status(
        self,
        formula: FormulaRecord,
        syntax_checks: Sequence[FormulaCheckResult],
        mathematical_checks: Sequence[FormulaCheckResult],
    ) -> VerificationStatus:
        current = formula.verification
        if current.status is VerificationStatus.REJECTED:
            return VerificationStatus.REJECTED
        if current.method is VerificationMethod.MANUAL and current.status is VerificationStatus.VERIFIED:
            return VerificationStatus.VERIFIED
        confidence = current.confidence
        if confidence is None or confidence < self.auto_verify_confidence:
            return VerificationStatus.NEEDS_REVIEW
        required = [
            *syntax_checks,
            *(check for check in mathematical_checks if check.name != "symbolic_equivalence" or check.status is not CheckStatus.NOT_APPLICABLE),
        ]
        if any(check.status in (CheckStatus.FAIL, CheckStatus.UNKNOWN) for check in required):
            return VerificationStatus.NEEDS_REVIEW
        return VerificationStatus.VERIFIED


FormulaValidator = SafeFormulaValidator

