from __future__ import annotations

import asyncio
import json
import math
import subprocess
import sys
from collections.abc import Mapping, Sequence
from typing import Any

import sympy as sp

from ..formulas.safe_sympy import SafeSympyParser, expression_difference


class _WorkerSymbolicEngine:
    """SymPy adapter accepting only expressions parsed by VECTOR AI's safe AST grammar."""

    def __init__(self, parser: SafeSympyParser | None = None) -> None:
        self.parser = parser or SafeSympyParser()

    async def evaluate(self, expression: str, variables: Mapping[str, Any]) -> Any:
        def work() -> Any:
            parsed = self.parser.parse(expression).expression
            allowed = {str(symbol): symbol for symbol in parsed.free_symbols}
            unknown = set(variables) - set(allowed)
            if unknown:
                raise ValueError(f"Biến không xuất hiện trong biểu thức: {sorted(unknown)}")
            substitutions = {allowed[name]: sp.Float(str(value)) for name, value in variables.items()}
            return str(sp.N(parsed.subs(substitutions), 15))
        return await asyncio.to_thread(work)


    async def simplify(self, expression: str) -> str:
        return await asyncio.to_thread(lambda: str(sp.simplify(self.parser.parse(expression).expression)))

    async def solve(self, expression: str, symbol: str) -> Sequence[str]:
        def work() -> list[str]:
            parsed = self.parser.parse(expression).expression
            target = next((item for item in parsed.free_symbols if str(item) == symbol), sp.Symbol(symbol))
            return [str(value) for value in sp.solve(expression_difference(parsed), target)]
        return await asyncio.to_thread(work)

    async def equivalent(self, left: str, right: str, assumptions: Sequence[str]) -> bool | None:
        # Assumptions are deliberately not interpreted as executable text.  If a
        # comparison needs assumptions that the restricted engine cannot model,
        # it reports UNKNOWN instead of guessing from sampled values.
        if assumptions:
            return None
        def work() -> bool | None:
            left_parsed = self.parser.parse(left).expression
            right_parsed = self.parser.parse(right).expression
            if isinstance(left_parsed, sp.Equality) != isinstance(right_parsed, sp.Equality):
                return False
            lhs = expression_difference(left_parsed)
            rhs = expression_difference(right_parsed)
            difference = sp.simplify(lhs - rhs)
            if difference == 0:
                return True
            if isinstance(left_parsed, sp.Equality):
                if rhs == 0:
                    return lhs == 0
                ratio = sp.simplify(lhs / rhs)
                if not ratio.free_symbols:
                    return bool(ratio != 0)
            if difference.is_zero is False:
                return False
            return None
        return await asyncio.to_thread(work)

class RestrictedSymbolicEngine:
    """Execute restricted SymPy operations in a disposable, owned subprocess.

    This isolates execution lifetime, not a full OS security sandbox. The AST
    allowlist still defines the accepted expression language.
    """

    def __init__(self, *, timeout_seconds: float = 10.0) -> None:
        if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise ValueError("Symbolic timeout must be positive")
        self.timeout_seconds = timeout_seconds

    async def _execute(self, operation: str, **arguments: Any) -> Any:
        payload = json.dumps({"operation": operation, **arguments}, allow_nan=False).encode("utf-8")
        if len(payload) > 64 * 1024:
            raise ValueError("Symbolic request is too large")
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "vector_ai_backend.adapters.symbolic_worker",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            async with asyncio.timeout(self.timeout_seconds):
                output, error = await process.communicate(payload)
            if process.returncode != 0:
                raise ValueError(f"Symbolic worker failed: {error.decode('utf-8', errors='replace')[-1500:]}")
            result = json.loads(output)
            if not result.get("ok"):
                raise ValueError(result.get("error", "Symbolic evaluation failed"))
            return result["value"]
        finally:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()

    async def evaluate(self, expression: str, variables: Mapping[str, Any]) -> Any:
        return await self._execute("evaluate", expression=expression, variables=dict(variables))

    async def simplify(self, expression: str) -> str:
        return await self._execute("simplify", expression=expression)

    async def solve(self, expression: str, symbol: str) -> Sequence[str]:
        return await self._execute("solve", expression=expression, symbol=symbol)

    async def equivalent(self, left: str, right: str, assumptions: Sequence[str]) -> bool | None:
        return await self._execute("equivalent", left=left, right=right, assumptions=list(assumptions))
