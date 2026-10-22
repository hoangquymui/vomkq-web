from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from vector_ai_backend.application.resources import InferenceScheduler, ResourceManager
from vector_ai_backend.application.tools import ToolRegistry, ToolInputError, ToolOutputError, SymbolicMathTool
from vector_ai_backend.adapters.symbolic import RestrictedSymbolicEngine
from vector_ai_backend.domain.models import (
    ResourceLimits, ResourceRequest, SourceScope, ToolDescriptor,
    ToolExecutionContext, ToolPolicy, ToolRequest, ToolResult, WorkPriority,
)


class Echo:
    descriptor = ToolDescriptor("test.echo", "1", "test", {"type": "object"},
                                {"type": "object", "required": ["answer"], "properties": {"answer": {"type": "number"}}}, ("test",))
    called = False

    async def execute(self, arguments, context):
        self.called = True
        return ToolResult(True, arguments)


def fixture(tool=None):
    manager = ResourceManager(ResourceLimits(1, 512, 0))
    policy = ToolPolicy(frozenset({"test.echo"}), frozenset({"test"}))
    registry = ToolRegistry(InferenceScheduler(manager), policy)
    registry.register(tool or Echo())
    return registry, manager, ToolExecutionContext("test", SourceScope(), policy)


def test_tool_rejects_non_json_and_nonfinite_before_execute():
    async def run():
        tool = Echo()
        registry, _, context = fixture(tool)
        for value in (float("nan"), float("inf"), object()):
            with pytest.raises(ToolInputError):
                await registry.execute(ToolRequest("test.echo", {"nested": [value]}), context)
        assert not tool.called
    asyncio.run(run())


def test_output_schema_is_enforced():
    async def run():
        registry, _, context = fixture()
        with pytest.raises(ToolOutputError):
            await registry.execute(ToolRequest("test.echo", {"answer": "wrong type"}), context)
        assert (await registry.execute(ToolRequest("test.echo", {"answer": 2}), context)).data["answer"] == 2
    asyncio.run(run())


def test_registration_rejects_unsupported_schema():
    tool = Echo()
    tool.descriptor = replace(tool.descriptor, input_schema={"type": "object", "oneOf": []})
    with pytest.raises(ValueError, match="unsupported"):
        fixture(tool)


def test_tool_timeout_includes_resource_queue():
    async def run():
        tool = Echo()
        registry, manager, context = fixture(tool)
        context.timeout_seconds = 0.02
        async with manager.lease(ResourceRequest("occupied", WorkPriority.INTERACTIVE_CHAT, 1, 1)):
            with pytest.raises(TimeoutError):
                await registry.execute(ToolRequest("test.echo", {"answer": 2}), context)
        assert not tool.called
    asyncio.run(run())


def test_cancel_running_tool_cleans_up():
    async def run():
        started, cleaned = asyncio.Event(), asyncio.Event()
        class Waiting(Echo):
            async def execute(self, arguments, context):
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cleaned.set()
        registry, _, context = fixture(Waiting())
        context.cancellation = asyncio.Event()
        task = asyncio.create_task(registry.execute(ToolRequest("test.echo", {}), context))
        await started.wait()
        context.cancellation.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cleaned.is_set()
    asyncio.run(run())


def test_process_symbolic_engine_evaluates_and_rejects_code():
    async def run():
        engine = RestrictedSymbolicEngine()
        assert float(await engine.evaluate("64 / 32", {})) == 2
        assert await engine.simplify("x + x") == "2*x"
        assert set(await engine.solve("x**2 - 4", "x")) == {"-2", "2"}
        with pytest.raises(ValueError):
            await engine.evaluate("__import__('os').getcwd()", {})
        assert await engine.equivalent("x+x", "2*x", ()) is True
    asyncio.run(run())


def test_symbolic_worker_is_killed_on_timeout(monkeypatch):
    async def run():
        class Child:
            returncode = None
            killed = False
            async def communicate(self, _):
                await asyncio.Event().wait()
            def kill(self):
                self.killed = True
                self.returncode = -1
            async def wait(self):
                return self.returncode
        child = Child()
        async def spawn(*args, **kwargs):
            return child
        monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
        with pytest.raises(TimeoutError):
            await RestrictedSymbolicEngine(timeout_seconds=0.01).evaluate("1+1", {})
        assert child.killed
    asyncio.run(run())
