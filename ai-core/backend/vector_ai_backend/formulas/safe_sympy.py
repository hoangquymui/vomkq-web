"""Restricted conversion of formula text into SymPy expressions.

This module intentionally does not call ``sympify`` or ``parse_expr`` on
untrusted document text.  It parses a small Python-like expression grammar
with :mod:`ast`, validates every node, and constructs SymPy objects directly.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Final

import sympy as sp


class SafeExpressionError(ValueError):
    """Raised when an expression is outside VECTOR AI's safe grammar."""


_IDENTIFIER: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_DECIMAL_COMMA: Final[re.Pattern[str]] = re.compile(r"(?<=\d),(?=\d)(?!\d*[,;])")
_TOKEN: Final[re.Pattern[str]] = re.compile(
    r"\s*(\*\*|[A-Za-z_][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/=,])"
)


@dataclass(frozen=True, slots=True)
class ParsedExpression:
    """Parsed expression and the normalized safe input that produced it."""

    expression: sp.Basic
    safe_text: str


class SafeSympyParser:
    """Parse a deliberately small expression language without ``eval``."""

    def __init__(self, *, max_length: int = 4096, max_nodes: int = 512) -> None:
        self.max_length = max_length
        self.max_nodes = max_nodes
        self._functions = {
            "sqrt": sp.sqrt,
            "sin": sp.sin,
            "cos": sp.cos,
            "tan": sp.tan,
            "asin": sp.asin,
            "acos": sp.acos,
            "atan": sp.atan,
            "log": sp.log,
            "ln": sp.log,
            "exp": sp.exp,
            "abs": sp.Abs,
            "Abs": sp.Abs,
        }
        # Keep upper-case ``E`` available as a normal symbol because it commonly
        # denotes energy.  Euler's number is exposed with the unambiguous name.
        self._constants = {"pi": sp.pi, "EulerE": sp.E}

    def parse(self, expression: str) -> ParsedExpression:
        if not isinstance(expression, str) or not expression.strip():
            raise SafeExpressionError("Biểu thức trống.")
        if len(expression) > self.max_length:
            raise SafeExpressionError("Biểu thức vượt quá giới hạn độ dài.")

        safe_text = self.normalize_input(expression)
        lhs_rhs = self._split_equation(safe_text)
        if lhs_rhs is None:
            parsed = self._parse_side(safe_text)
        else:
            lhs, rhs = lhs_rhs
            parsed = sp.Eq(self._parse_side(lhs), self._parse_side(rhs), evaluate=False)
        return ParsedExpression(expression=parsed, safe_text=safe_text)

    def normalize_input(self, expression: str) -> str:
        value = expression.strip()
        if "\\" in value or "{" in value or "}" in value:
            value = self.latex_to_expression(value)
        value = (
            value.replace("−", "-")
            .replace("×", "*")
            .replace("·", "*")
            .replace("÷", "/")
            .replace("^", "**")
        )
        value = _DECIMAL_COMMA.sub(".", value)
        return self._insert_implicit_multiplication(value)

    def latex_to_expression(self, latex: str) -> str:
        """Convert a conservative subset of LaTeX into the safe grammar."""

        value = latex.strip().strip("$")
        value = value.replace("\\left", "").replace("\\right", "")
        value = value.replace("\\cdot", "*").replace("\\times", "*")
        value = value.replace("\\div", "/")
        value = value.replace("\\,", " ").replace("\\;", " ").replace("\\!", "")
        value = self._replace_braced_command(value, "frac", lambda a, b: f"(({a})/({b}))", 2)
        value = self._replace_braced_command(value, "dfrac", lambda a, b: f"(({a})/({b}))", 2)
        value = self._replace_braced_command(value, "tfrac", lambda a, b: f"(({a})/({b}))", 2)
        value = self._replace_braced_command(value, "sqrt", lambda a: f"sqrt({a})", 1)
        replacements = {
            "\\sin": "sin",
            "\\cos": "cos",
            "\\tan": "tan",
            "\\arcsin": "asin",
            "\\arccos": "acos",
            "\\arctan": "atan",
            "\\ln": "ln",
            "\\log": "log",
            "\\exp": "exp",
            "\\pi": "pi",
        }
        for old, new in replacements.items():
            value = value.replace(old, new)
        value = re.sub(r"([A-Za-z][A-Za-z0-9]*)_\{([A-Za-z0-9]+)\}", r"\1_\2", value)
        value = re.sub(r"([A-Za-z][A-Za-z0-9]*)_([A-Za-z0-9])", r"\1_\2", value)
        value = value.replace("{", "(").replace("}", ")")
        if re.search(r"\\[A-Za-z]+", value):
            unknown = re.search(r"\\[A-Za-z]+", value)
            assert unknown is not None
            raise SafeExpressionError(f"Lệnh LaTeX chưa được hỗ trợ: {unknown.group(0)}")
        return value

    def _replace_braced_command(self, text: str, command: str, render, arity: int) -> str:
        marker = f"\\{command}"
        while marker in text:
            start = text.find(marker)
            cursor = start + len(marker)
            arguments: list[str] = []
            for _ in range(arity):
                while cursor < len(text) and text[cursor].isspace():
                    cursor += 1
                if cursor >= len(text) or text[cursor] != "{":
                    raise SafeExpressionError(f"{marker} phải có {arity} đối số trong ngoặc nhọn.")
                argument, cursor = self._read_group(text, cursor)
                arguments.append(self.latex_to_expression(argument))
            text = text[:start] + render(*arguments) + text[cursor:]
        return text

    @staticmethod
    def _read_group(text: str, start: int) -> tuple[str, int]:
        depth = 0
        for index in range(start, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    return text[start + 1 : index], index + 1
        raise SafeExpressionError("Ngoặc nhọn LaTeX không cân bằng.")

    def _insert_implicit_multiplication(self, expression: str) -> str:
        tokens: list[str] = []
        cursor = 0
        while cursor < len(expression):
            match = _TOKEN.match(expression, cursor)
            if match is None:
                if expression[cursor:].strip() == "":
                    break
                raise SafeExpressionError(
                    f"Ký tự không được hỗ trợ tại vị trí {cursor}: {expression[cursor:cursor + 12]!r}"
                )
            tokens.append(match.group(1))
            cursor = match.end()

        output: list[str] = []
        for token in tokens:
            if output and self._needs_multiplication(output[-1], token):
                output.append("*")
            output.append(token)
        return "".join(output)

    def _needs_multiplication(self, left: str, right: str) -> bool:
        left_value = left == ")" or left[0].isdigit() or _IDENTIFIER.match(left) is not None
        right_value = right == "(" or right[0].isdigit() or _IDENTIFIER.match(right) is not None
        if not (left_value and right_value):
            return False
        if _IDENTIFIER.match(left) and right == "(" and left in self._functions:
            return False
        return True

    @staticmethod
    def _split_equation(expression: str) -> tuple[str, str] | None:
        depth = 0
        locations: list[int] = []
        for index, char in enumerate(expression):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth < 0:
                    raise SafeExpressionError("Ngoặc tròn không cân bằng.")
            elif char == "=" and depth == 0:
                locations.append(index)
        if depth:
            raise SafeExpressionError("Ngoặc tròn không cân bằng.")
        if not locations:
            return None
        if len(locations) != 1:
            raise SafeExpressionError("Chỉ hỗ trợ một dấu bằng trong mỗi biểu thức.")
        index = locations[0]
        if not expression[:index] or not expression[index + 1 :]:
            raise SafeExpressionError("Hai vế của phương trình phải có nội dung.")
        return expression[:index], expression[index + 1 :]

    def _parse_side(self, expression: str) -> sp.Basic:
        try:
            tree = ast.parse(expression, mode="eval")
        except SyntaxError as exc:
            raise SafeExpressionError(f"Cú pháp biểu thức không hợp lệ: {exc.msg}") from exc
        nodes = list(ast.walk(tree))
        if len(nodes) > self.max_nodes:
            raise SafeExpressionError("Biểu thức vượt quá giới hạn độ phức tạp.")
        return self._convert(tree.body)

    def _convert(self, node: ast.AST) -> sp.Basic:
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
                raise SafeExpressionError("Chỉ hỗ trợ hằng số số học.")
            return sp.Integer(node.value) if isinstance(node.value, int) else sp.Float(str(node.value))
        if isinstance(node, ast.Name):
            if not _IDENTIFIER.match(node.id) or node.id.startswith("__"):
                raise SafeExpressionError(f"Tên ký hiệu không hợp lệ: {node.id!r}")
            if node.id in self._constants:
                return self._constants[node.id]
            return sp.Symbol(node.id)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = self._convert(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp):
            left = self._convert(node.left)
            right = self._convert(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Pow):
                return left**right
            raise SafeExpressionError(f"Toán tử không được hỗ trợ: {type(node.op).__name__}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in self._functions:
                raise SafeExpressionError("Hàm không nằm trong allowlist.")
            if node.keywords:
                raise SafeExpressionError("Không hỗ trợ đối số có tên.")
            arguments = [self._convert(argument) for argument in node.args]
            if len(arguments) != 1:
                raise SafeExpressionError("Hàm được hỗ trợ phải có đúng một đối số.")
            return self._functions[node.func.id](*arguments)
        raise SafeExpressionError(f"Cấu trúc không được hỗ trợ: {type(node).__name__}")


def expression_difference(expression: sp.Basic) -> sp.Basic:
    """Return an expression suitable for equivalence/domain analysis."""

    if isinstance(expression, sp.Equality):
        return expression.lhs - expression.rhs
    return expression
