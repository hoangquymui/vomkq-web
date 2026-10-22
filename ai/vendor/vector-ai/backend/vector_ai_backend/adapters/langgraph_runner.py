from __future__ import annotations

import asyncio
from typing import Any, TypedDict

from ..application.workflows import DocumentIngestionGraph, QueryReasoningGraph
from ..domain.models import DocumentIngestionState, QueryReasoningState
from ..domain.models import RunEvent, RunEventType
from ..domain.ports import EventEmitter


def langgraph_available() -> bool:
    try:
        import langgraph  # noqa: F401
    except ImportError:
        return False
    return True


class LangGraphDocumentIngestionRunner:
    """LangGraph adapter with a direct runner fallback for minimal installations."""

    def __init__(self, direct: DocumentIngestionGraph, prefer_langgraph: bool = True) -> None:
        self._direct = direct
        self.backend = "langgraph" if prefer_langgraph and langgraph_available() else "direct"

    async def run(
        self, state: DocumentIngestionState, emit: EventEmitter
    ) -> DocumentIngestionState:
        if self.backend == "direct":
            return await self._direct.run(state, emit)
        from langgraph.graph import END, START, StateGraph

        class GraphState(TypedDict):
            state: DocumentIngestionState
            completed_stages: list[str]

        graph = StateGraph(GraphState)
        stages = self._direct.stage_order
        cancellation = self._direct._cancellations.setdefault(state.run_id, asyncio.Event())
        saved = await self._direct.checkpoints.load(state.checkpoint_namespace, state.run_id)
        completed_before = list(saved.get("completed_stages", [])) if saved else []
        if saved and isinstance(saved.get("checkpoint"), dict):
            state.checkpoint.update(saved["checkpoint"])
        await emit(RunEvent(run_id=state.run_id, type=RunEventType.STARTED, stage=state.stage))

        for position, stage in enumerate(stages):
            async def node(raw: GraphState, stage: str = stage, position: int = position) -> GraphState:
                current: DocumentIngestionState = raw["state"]
                completed = list(raw.get("completed_stages", []))
                if stage in completed:
                    return {"state": current, "completed_stages": completed}
                if cancellation.is_set():
                    raise asyncio.CancelledError
                current.stage = stage
                await emit(
                    RunEvent(
                        run_id=current.run_id,
                        type=RunEventType.STAGE,
                        stage=stage,
                        progress=position / max(1, len(stages)),
                        data={"resources": await self._direct.scheduler.resources.snapshot()},
                    )
                )
                handler = self._direct.steps[stage]
                current = await handler(current, emit, cancellation)
                completed.append(stage)
                current.checkpoint["completed_stages"] = completed
                await self._direct.checkpoints.save(
                    current.checkpoint_namespace,
                    current.run_id,
                    {
                        "document_id": current.document_id,
                        "document_version": current.document_version,
                        "stage": stage,
                        "completed_stages": completed,
                        "checkpoint": dict(current.checkpoint),
                    },
                )
                return {"state": current, "completed_stages": completed}

            graph.add_node(stage, node)
        graph.add_edge(START, stages[0])
        for left, right in zip(stages, stages[1:]):
            graph.add_edge(left, right)
        graph.add_edge(stages[-1], END)
        try:
            compiled = graph.compile()
            result = await compiled.ainvoke(
                {"state": state, "completed_stages": completed_before}
            )
            completed: DocumentIngestionState = result["state"]
            completed.stage = "completed"
            await emit(
                RunEvent(
                    run_id=completed.run_id,
                    type=RunEventType.COMPLETED,
                    stage="completed",
                    progress=1.0,
                    data={"resources": await self._direct.scheduler.resources.snapshot()},
                )
            )
            return completed
        except asyncio.CancelledError:
            state.stage = "cancelled"
            await emit(
                RunEvent(run_id=state.run_id, type=RunEventType.CANCELLED, stage="cancelled")
            )
            return state
        finally:
            self._direct._cancellations.pop(state.run_id, None)

    async def cancel(self, run_id: str) -> None:
        await self._direct.cancel(run_id)


class LangGraphQueryReasoningRunner:
    """A separate LangGraph lifecycle for queries; never shares ingestion state."""

    def __init__(self, direct: QueryReasoningGraph, prefer_langgraph: bool = True) -> None:
        self._direct = direct
        self.backend = "langgraph" if prefer_langgraph and langgraph_available() else "direct"

    async def run(self, state: QueryReasoningState, emit: EventEmitter) -> QueryReasoningState:
        if self.backend == "direct":
            return await self._direct.run(state, emit)
        from langgraph.graph import END, START, StateGraph

        class GraphState(TypedDict):
            state: QueryReasoningState

        graph = StateGraph(GraphState)
        run_id = state.request.run_id
        cancellation = self._direct._cancellations.setdefault(run_id, asyncio.Event())

        async def retrieve(raw: GraphState) -> GraphState:
            current = await self._direct.service.retrieve_stage(raw["state"], emit, cancellation)
            await self._direct.checkpoints.save(
                current.checkpoint_namespace, run_id,
                {"stage": "retrieved", "workflow_id": current.request.workflow_id, "checkpoint": dict(current.checkpoint)},
            )
            return {"state": current}

        async def generate(raw: GraphState) -> GraphState:
            current = await self._direct.service.generate_stage(raw["state"], emit, cancellation)
            await self._direct.checkpoints.save(
                current.checkpoint_namespace, run_id,
                {"stage": current.stage, "workflow_id": current.request.workflow_id, "checkpoint": dict(current.checkpoint)},
            )
            return {"state": current}

        graph.add_node("retrieve_and_fuse", retrieve)
        graph.add_node("budget_and_generate", generate)
        graph.add_edge(START, "retrieve_and_fuse")
        graph.add_edge("retrieve_and_fuse", "budget_and_generate")
        graph.add_edge("budget_and_generate", END)
        await emit(RunEvent(run_id=run_id, type=RunEventType.STARTED, stage="received"))
        try:
            result = await graph.compile().ainvoke({"state": state})
            return result["state"]
        except asyncio.CancelledError:
            state.stage = "cancelled"
            await self._direct.checkpoints.save(
                state.checkpoint_namespace, run_id,
                {"stage": "cancelled", "workflow_id": state.request.workflow_id, "checkpoint": dict(state.checkpoint)},
            )
            await emit(RunEvent(run_id=run_id, type=RunEventType.CANCELLED, stage="cancelled"))
            return state
        finally:
            self._direct._cancellations.pop(run_id, None)

    async def cancel(self, run_id: str) -> None:
        await self._direct.cancel(run_id)
