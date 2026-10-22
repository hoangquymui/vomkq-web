"""Deterministic semantic text for formula embeddings."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any


FORMULA_SEMANTIC_VERSION = "formula-semantic-v1"


def _value(record: Any, name: str, default: Any = None) -> Any:
    if isinstance(record, Mapping):
        return record.get(name, default)
    return getattr(record, name, default)


def _clean(value: Any) -> str:
    return " ".join(str(value).strip().split()) if value is not None else ""


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        return list(value.items())
    if isinstance(value, Iterable):
        return list(value)
    return [value]


def _format_variables(variables: Any) -> list[str]:
    rows: list[str] = []
    if isinstance(variables, Mapping):
        variables = [{"symbol": key, **(value if isinstance(value, Mapping) else {"description": value})} for key, value in variables.items()]
    for variable in _list(variables):
        if isinstance(variable, tuple) and len(variable) == 2:
            variable = {"symbol": variable[0], "description": variable[1]}
        symbol = _clean(_value(variable, "symbol", _value(variable, "name", "")))
        description = _clean(_value(variable, "description", _value(variable, "meaning", "")))
        unit = _clean(_value(variable, "unit", ""))
        if not symbol:
            continue
        suffix = f": {description}" if description else ""
        suffix += f" [{unit}]" if unit else ""
        rows.append(f"{symbol}{suffix}")
    return rows


def _format_units(units: Any) -> list[str]:
    if isinstance(units, Mapping):
        return [f"{_clean(key)}: {_clean(value)}" for key, value in units.items() if _clean(key) and _clean(value)]
    return [_clean(value) for value in _list(units) if _clean(value)]


def formula_semantic_representation(record: Any, *, source_context: str = "") -> str:
    """Build stable Vietnamese semantic content without inventing metadata."""

    lines: list[str] = [f"Phiên bản biểu diễn: {FORMULA_SEMANTIC_VERSION}"]
    name = _clean(_value(record, "name", _value(record, "formula_name", "")))
    normalized = _clean(_value(record, "normalized_latex", ""))
    aliases = [_clean(item) for item in _list(_value(record, "aliases", ())) if _clean(item)]
    conditions = [_clean(item) for item in _list(_value(record, "conditions", ())) if _clean(item)]
    assumptions = [_clean(item) for item in _list(_value(record, "assumptions", ())) if _clean(item)]
    variables = _format_variables(_value(record, "variables", ()))
    units = _format_units(_value(record, "units", {}))
    source = _clean(source_context)
    if not source:
        source_data = _value(record, "source", None)
        source = _clean(_value(source_data, "title", _value(source_data, "document_title", "")))

    if name:
        lines.append(f"Tên công thức: {name}")
    if normalized:
        lines.append(f"Biểu thức chuẩn hóa: {normalized}")
    if variables:
        lines.append("Biến: " + "; ".join(variables))
    if units:
        lines.append("Đơn vị: " + "; ".join(units))
    if conditions:
        lines.append("Điều kiện: " + "; ".join(conditions))
    if assumptions:
        lines.append("Giả thiết: " + "; ".join(assumptions))
    if aliases:
        lines.append("Tên gọi khác: " + "; ".join(aliases))
    if source:
        lines.append(f"Ngữ cảnh nguồn: {source}")
    return "\n".join(lines)
