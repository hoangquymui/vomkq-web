"""Which pending formulas are allowed to hide a chunk from retrieval.

A specification table and the ratios a user types into its cells
(``10W87/570KT``) are data, not mathematical claims waiting for a review, so
they must never make their chunk unretrievable.  The rules live only here: the
ingestion extraction step and the chunk eligibility recompute both call these
helpers, so the two can never drift apart.
"""

from __future__ import annotations

import re

from ..domain.models import VerificationStatus

# Both sides of a plain ratio carry no structure at all: only digits, letters,
# dots, commas and spaces (10W87, 570KT, 1.452, ALCM, 100KT).  Anything else
# (a+b, x_{i}, \alpha, \cdot) is a real formula and keeps going to review.
_PLAIN_SIDE = re.compile(r"^\s*[0-9A-Za-z.,\s]+$")
_FRACTION = re.compile(r"^\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}$")
_TABLE_ROW_START = re.compile(r"^[ \t]*\|")


def _body(latex: str) -> str:
    """Drop the delimiters the editor writes so a bare latex body can be read."""
    value = str(latex or "").strip()
    while len(value) >= 2 and value.startswith("$") and value.endswith("$"):
        value = value[1:-1].strip()
    return value


def is_plain_ratio(latex: str) -> bool:
    """True for a bare ``\\frac{X}{Y}`` whose sides are plain tokens."""
    match = _FRACTION.match(_body(latex))
    if match is None:
        return False
    return all(side.strip() and _PLAIN_SIDE.match(side) for side in match.groups())


def _occurrences(text: str, latex: str) -> list[tuple[int, int]]:
    needle = _body(latex)
    if not needle or not text:
        return []
    # Stored LaTeX may be whitespace-normalized, so any run of spaces matches.
    pattern = re.compile(r"\s+".join(re.escape(part) for part in needle.split()))
    return [(match.start(), match.end()) for match in pattern.finditer(text)]


def _inside_table_row(text: str, start: int, end: int) -> bool:
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    lines = text[line_start:len(text) if line_end < 0 else line_end].splitlines() or [""]
    return all(_TABLE_ROW_START.match(line) for line in lines)


def appears_in_table_row(text: str, latex: str) -> bool:
    """True when at least one occurrence of *latex* sits in a pipe-table row."""
    return any(_inside_table_row(text, start, end) for start, end in _occurrences(text, latex))


def only_appears_in_table_rows(text: str, latex: str) -> bool:
    """True when *latex* occurs in *text* and every occurrence is a table row.

    A formula the prose also uses stays a formula of that prose, so it keeps
    gating its chunk.
    """
    occurrences = _occurrences(text, latex)
    return bool(occurrences) and all(_inside_table_row(text, start, end) for start, end in occurrences)


def is_needs_review(status: VerificationStatus | str) -> bool:
    """True only for the one status that still waits for a human decision."""
    return str(getattr(status, "value", status)) == VerificationStatus.NEEDS_REVIEW.value


def blocks_retrieval(*, status: VerificationStatus | str, latex: str, chunk_text: str) -> bool:
    """Whether one linked formula must keep its chunk out of retrieval.

    ``VERIFIED`` and ``REJECTED`` never block: a rejected formula is a decision
    the reviewer already made, so the chunk text is usable again.  A plain
    ratio is data wherever it appears, and a formula that only appears in table
    rows is that table's data too.
    """
    if not is_needs_review(status):
        return False
    if is_plain_ratio(latex):
        return False
    return not only_appears_in_table_rows(chunk_text, latex)
