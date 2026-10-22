from __future__ import annotations

import asyncio
import math
import json
from collections.abc import Mapping
from typing import Any

from ..domain.models import (
    ResourceRequest,
    RetrievalRequest,
    ToolDescriptor,
    ToolExecutionContext,
    ToolPolicy,
    ToolRequest,
    ToolResult,
    WorkPriority,
)
from ..domain.ports import Retriever, SymbolicEngine, Tool
from .resources import InferenceScheduler


class ToolError(RuntimeError):
    code = "tool_error"


class ToolNotFoundError(ToolError):
    code = "tool_not_found"


class ToolPolicyError(ToolError):
    code = "tool_not_allowed"


class ToolInputError(ToolError):
    code = "invalid_tool_input"


class ToolOutputError(ToolError):
    code = "invalid_tool_output"


def check_schema(schema: Mapping[str, Any]) -> None:
    """Reject unsupported schema keywords instead of silently ignoring them."""
    supported = {"type", "enum", "properties", "required", "additionalProperties", "items",
                 "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "description", "title"}
    if not isinstance(schema, Mapping) or set(schema) - supported:
        raise ValueError("Tool schema uses unsupported keywords")
    if schema.get("type") not in {"object", "array", "string", "number", "integer", "boolean", "null"}:
        raise ValueError("Tool schema needs a supported explicit type")
    for child in schema.get("properties", {}).values():
        check_schema(child)
    if "items" in schema:
        check_schema(schema["items"])
    additional = schema.get("additionalProperties", True)
    if isinstance(additional, Mapping):
        check_schema(additional)
    elif type(additional) is not bool:
        raise ValueError("Invalid additionalProperties schema")


def check_json_value(value: Any, *, max_bytes: int) -> None:
    """Bound nesting and reject non-JSON/nonfinite values even in free fields."""
    pending = [(value, 0)]
    count = 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if depth > 24 or count > 50_000:
            raise ToolInputError("Tool payload is too deeply nested or too large")
        if isinstance(item, dict):
            if any(not isinstance(key, str) for key in item):
                raise ToolInputError("Tool object keys must be strings")
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
        elif type(item) not in {str, int, float, bool, type(None)}:
            raise ToolInputError("Tool payload must contain only JSON values")
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ToolInputError("Invalid JSON tool payload") from exc
    if len(encoded.encode("utf-8")) > max_bytes:
        raise ToolInputError("Tool payload exceeds size limit")


def validate_json_schema(value: Any, schema: Mapping[str, Any], path: str = "$") -> None:
    """Small dependency-free validator for the schemas exposed by local tools."""
    expected = schema.get("type")
    type_map = {
        "object": dict,
        "array": list,
        "string": str,
        "number": (int, float),
        "integer": int,
        "boolean": bool,
        "null": type(None),
    }
    if expected in type_map:
        valid_type = type_map[expected]
        if not isinstance(value, valid_type) or expected in {"number", "integer"} and isinstance(value, bool):
            raise ToolInputError(f"{path} must be {expected}")
    if "enum" in schema and value not in schema["enum"]:
        raise ToolInputError(f"{path} must be one of {schema['enum']}")

    if expected == "object":
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        for name in required:
            if name not in value:
                raise ToolInputError(f"{path}.{name} is required")
        if schema.get("additionalProperties") is False:
            unknown = set(value) - set(properties)
            if unknown:
                raise ToolInputError(f"{path} contains unsupported fields: {sorted(unknown)}")
        for name, item in value.items():
            if name in properties:
                validate_json_schema(item, properties[name], f"{path}.{name}")
            elif isinstance(schema.get("additionalProperties"), Mapping):
                validate_json_schema(item, schema["additionalProperties"], f"{path}.{name}")
    elif expected == "array":
        if "minItems" in schema and len(value) < int(schema["minItems"]):
            raise ToolInputError(f"{path} has too few items")
        if "maxItems" in schema and len(value) > int(schema["maxItems"]):
            raise ToolInputError(f"{path} has too many items")
        item_schema = schema.get("items")
        if item_schema:
            for index, item in enumerate(value):
                validate_json_schema(item, item_schema, f"{path}[{index}]")
    elif expected == "string":
        if "minLength" in schema and len(value) < int(schema["minLength"]):
            raise ToolInputError(f"{path} is too short")
        if "maxLength" in schema and len(value) > int(schema["maxLength"]):
            raise ToolInputError(f"{path} is too long")
    elif expected in {"number", "integer"}:
        if isinstance(value, float) and not math.isfinite(value):
            raise ToolInputError(f"{path} must be finite")
        if "minimum" in schema and value < schema["minimum"]:
            raise ToolInputError(f"{path} is below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            raise ToolInputError(f"{path} is above maximum")


class ToolRegistry:
    """Capability registry with mandatory allowlist and schema validation."""

    def __init__(
        self,
        scheduler: InferenceScheduler,
        system_policy: ToolPolicy,
    ) -> None:
        self._scheduler = scheduler
        self._system_policy = system_policy
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        name = tool.descriptor.name
        if name in self._tools:
            raise ValueError(f"Tool already registered: {name}")
        check_schema(tool.descriptor.input_schema)
        check_schema(tool.descriptor.output_schema)
        self._tools[name] = tool

    def descriptors(self) -> tuple[ToolDescriptor, ...]:
        return tuple(tool.descriptor for _, tool in sorted(self._tools.items()))

    @staticmethod
    def _allows(policy: ToolPolicy, descriptor: ToolDescriptor) -> bool:
        if descriptor.name not in policy.allowed_tools:
            return False
        return all(capability in policy.allowed_capabilities for capability in descriptor.capabilities)

    async def execute(self, request: ToolRequest, context: ToolExecutionContext) -> ToolResult:
        tool = self._tools.get(request.name)
        if tool is None:
            raise ToolNotFoundError(f"Unknown tool: {request.name}")
        descriptor = tool.descriptor
        if not self._allows(self._system_policy, descriptor) or not self._allows(
            context.policy, descriptor
        ):
            raise ToolPolicyError(f"Tool is not allowed: {request.name}")
        arguments = dict(request.arguments)
        check_json_value(arguments, max_bytes=64 * 1024)
        validate_json_schema(arguments, descriptor.input_schema)
        timeouts = (
            self._system_policy.max_timeout_seconds,
            context.policy.max_timeout_seconds,
            context.timeout_seconds,
        )
        if any(not math.isfinite(value) or value <= 0 for value in timeouts):
            raise ToolPolicyError("Tool timeout must be positive")
        timeout = min(timeouts)

        resource_request = ResourceRequest(
            owner=f"tool:{context.run_id}:{request.name}",
            priority=WorkPriority.INTERACTIVE_TOOL,
            cpu_slots=0 if getattr(tool, "manages_resources", False) else 1,
            ram_mb=0 if getattr(tool, "manages_resources", False) else 128,
        )

        async def invoke() -> ToolResult:
            result = await tool.execute(arguments, context)
            if not isinstance(result, ToolResult):
                raise ToolOutputError("Tool must return ToolResult")
            try:
                check_json_value(dict(result.data), max_bytes=2 * 1024 * 1024)
                if result.ok:
                    validate_json_schema(dict(result.data), descriptor.output_schema)
            except (ToolInputError, TypeError, ValueError) as exc:
                raise ToolOutputError(str(exc)) from exc
            return result

        # Budget includes admission wait. Cancelling the run also cancels the
        # tool task; process-backed adapters clean up their owned subprocess.
        task = asyncio.create_task(self._scheduler.run(resource_request, invoke, cancellation=context.cancellation))
        cancelled = asyncio.create_task(context.cancellation.wait()) if context.cancellation else None
        try:
            async with asyncio.timeout(timeout):
                if cancelled is not None:
                    await asyncio.wait((task, cancelled), return_when=asyncio.FIRST_COMPLETED)
                    if context.cancellation.is_set():
                        raise asyncio.CancelledError
                return await task
        finally:
            if not task.done():
                task.cancel()
            if cancelled is not None:
                cancelled.cancel()
            await asyncio.gather(task, *([cancelled] if cancelled else []), return_exceptions=True)


class SymbolicMathTool:
    def __init__(self, engine: SymbolicEngine) -> None:
        self._engine = engine

    @property
    def descriptor(self) -> ToolDescriptor:
        return ToolDescriptor(
            name="math.sympy",
            version="1.0",
            description="Evaluate, simplify, solve or compare a restricted symbolic expression.",
            capabilities=("math", "symbolic"),
            input_schema={
                "type": "object",
                "required": ["operation", "expression"],
                "additionalProperties": False,
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["evaluate", "simplify", "solve", "equivalent"],
                    },
                    "expression": {"type": "string", "minLength": 1, "maxLength": 4096},
                    "variables": {"type": "object", "additionalProperties": {"type": "number"}},
                    "symbol": {"type": "string", "maxLength": 128},
                    "reference": {"type": "string", "maxLength": 4096},
                    "assumptions": {
                        "type": "array",
                        "maxItems": 64,
                        "items": {"type": "string", "maxLength": 256},
                    },
                },
            },
            output_schema={"type": "object"},
        )

    async def execute(
        self,
        arguments: Mapping[str, Any],
        context: ToolExecutionContext,
    ) -> ToolResult:
        operation = str(arguments["operation"])
        expression = str(arguments["expression"])
        try:
            if operation == "evaluate":
                value = await self._engine.evaluate(expression, arguments.get("variables", {}))
            elif operation == "simplify":
                value = await self._engine.simplify(expression)
            elif operation == "solve":
                symbol = str(arguments.get("symbol", ""))
                if not symbol:
                    raise ValueError("symbol is required for solve")
                value = list(await self._engine.solve(expression, symbol))
            else:
                reference = str(arguments.get("reference", ""))
                if not reference:
                    raise ValueError("reference is required for equivalent")
                value = await self._engine.equivalent(
                    expression,
                    reference,
                    tuple(arguments.get("assumptions", [])),
                )
            return ToolResult(ok=True, data={"operation": operation, "value": value})
        except Exception as exc:
            return ToolResult(
                ok=False,
                error={"code": "symbolic_error", "message": str(exc)},
            )


class RagSearchTool:
    # RetrievalService admits its embedding work to the same scheduler. Holding
    # an outer CPU lease here would deadlock when only one CPU slot is available.
    manages_resources = True

    def __init__(self, retriever: Retriever, embedding_profile_id: str) -> None:
        self._retriever = retriever
        self._embedding_profile_id = embedding_profile_id

    @property
    def descriptor(self) -> ToolDescriptor:
        return ToolDescriptor(
            name="rag.search",
            version="1.0",
            description="Search verified local evidence without invoking the chat workflow.",
            capabilities=("rag", "retrieval"),
            input_schema={
                "type": "object",
                "required": ["query"],
                "additionalProperties": False,
                "properties": {
                    "query": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 20},
                    "evidence_tokens": {"type": "integer", "minimum": 128, "maximum": 8000},
                },
            },
            output_schema={"type": "object"},
        )

    async def execute(
        self,
        arguments: Mapping[str, Any],
        context: ToolExecutionContext,
    ) -> ToolResult:
        request = RetrievalRequest(
            query=str(arguments["query"]),
            scope=context.source_scope,
            embedding_profile_id=self._embedding_profile_id,
            top_k=int(arguments.get("top_k", 4)),
            evidence_token_limit=int(arguments.get("evidence_tokens", 1500)),
        )
        hits = await self._retriever.retrieve(request)
        return ToolResult(
            ok=True,
            data={
                "hits": [
                    {
                        "chunk_id": hit.chunk_id,
                        "text": hit.text,
                        "score": hit.score,
                        "metadata": dict(hit.metadata),
                    }
                    for hit in hits
                ]
            },
            sources=tuple(hit.source for hit in hits),
        )
