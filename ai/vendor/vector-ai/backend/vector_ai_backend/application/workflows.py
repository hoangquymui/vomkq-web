from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import asdict
from typing import Any

from ..domain.models import (
    DocumentIngestionState,
    QueryReasoningState,
    RunEvent,
    RunEventType,
)
from ..domain.ports import CheckpointStore, EventEmitter
from .resources import InferenceScheduler
from .services import QueryReasoningService


IngestionStep = Callable[
    [DocumentIngestionState, EventEmitter, asyncio.Event],
    Awaitable[DocumentIngestionState],
]


class InMemoryCheckpointStore:
    def __init__(self) -> None:
        self._values: dict[tuple[str, str], dict[str, Any]] = {}

    async def load(self, namespace: str, run_id: str) -> Mapping[str, Any] | None:
        value = self._values.get((namespace, run_id))
        return dict(value) if value is not None else None

    async def save(self, namespace: str, run_id: str, state: Mapping[str, Any]) -> None:
        self._values[(namespace, run_id)] = dict(state)

    async def delete(self, namespace: str, run_id: str) -> None:
        self._values.pop((namespace, run_id), None)


class DocumentIngestionGraph:
    """Direct fallback for the independently checkpointed ingestion lifecycle."""

    DEFAULT_STAGES = ("extract", "ocr", "validate", "chunk", "embed", "index")

    def __init__(
        self,
        *,
        steps: Mapping[str, IngestionStep],
        checkpoints: CheckpointStore,
        scheduler: InferenceScheduler,
        stage_order: Sequence[str] = DEFAULT_STAGES,
    ) -> None:
        self.steps = dict(steps)
        self.stage_order = tuple(stage_order)
        self.checkpoints = checkpoints
        self.scheduler = scheduler
        self._cancellations: dict[str, asyncio.Event] = {}

    async def run(
        self,
        state: DocumentIngestionState,
        emit: EventEmitter,
    ) -> DocumentIngestionState:
        cancellation = self._cancellations.setdefault(state.run_id, asyncio.Event())
        saved = await self.checkpoints.load(state.checkpoint_namespace, state.run_id)
        completed = set(saved.get("completed_stages", [])) if saved else set()
        if saved and isinstance(saved.get("checkpoint"), dict):
            state.checkpoint.update(saved["checkpoint"])
        try:
            await emit(RunEvent(run_id=state.run_id, type=RunEventType.STARTED, stage=state.stage))
            for position, stage in enumerate(self.stage_order):
                if stage in completed:
                    continue
                if cancellation.is_set():
                    raise asyncio.CancelledError
                handler = self.steps.get(stage)
                if handler is None:
                    raise RuntimeError(f"Missing ingestion step: {stage}")
                state.stage = stage
                await emit(
                    RunEvent(
                        run_id=state.run_id,
                        type=RunEventType.STAGE,
                        stage=stage,
                        progress=position / max(1, len(self.stage_order)),
                        data={"resources": await self.scheduler.resources.snapshot()},
                    )
                )
                state = await handler(state, emit, cancellation)
                completed.add(stage)
                state.checkpoint["completed_stages"] = list(completed)
                await self.checkpoints.save(
                    state.checkpoint_namespace,
                    state.run_id,
                    {
                        "document_id": state.document_id,
                        "document_version": state.document_version,
                        "stage": stage,
                        "completed_stages": list(completed),
                        "checkpoint": dict(state.checkpoint),
                    },
                )
            state.stage = "completed"
            await emit(
                RunEvent(
                    run_id=state.run_id,
                    type=RunEventType.COMPLETED,
                    stage="completed",
                    progress=1.0,
                    data={"resources": await self.scheduler.resources.snapshot()},
                )
            )
            return state
        except asyncio.CancelledError:
            state.stage = "cancelled"
            await emit(RunEvent(run_id=state.run_id, type=RunEventType.CANCELLED, stage=state.stage))
            return state
        finally:
            self._cancellations.pop(state.run_id, None)

    async def cancel(self, run_id: str) -> None:
        cancellation = self._cancellations.get(run_id)
        if cancellation is not None:
            cancellation.set()


class QueryReasoningGraph:
    """Direct fallback for the query lifecycle, isolated from ingestion state."""

    def __init__(
        self,
        service: QueryReasoningService,
        checkpoints: CheckpointStore | None = None,
    ) -> None:
        self.service = service
        self.checkpoints = checkpoints or InMemoryCheckpointStore()
        self._cancellations: dict[str, asyncio.Event] = {}

    async def run(self, state: QueryReasoningState, emit: EventEmitter) -> QueryReasoningState:
        run_id = state.request.run_id
        cancellation = self._cancellations.setdefault(run_id, asyncio.Event())
        try:
            await self.checkpoints.save(
                state.checkpoint_namespace,
                run_id,
                {"stage": "running", "workflow_id": state.request.workflow_id},
            )
            result = await self.service.run(state, emit, cancellation)
            await self.checkpoints.save(
                state.checkpoint_namespace,
                run_id,
                {"stage": result.stage, "workflow_id": state.request.workflow_id},
            )
            return result
        except asyncio.CancelledError:
            state.stage = "cancelled"
            await self.checkpoints.save(
                state.checkpoint_namespace,
                run_id,
                {"stage": "cancelled", "workflow_id": state.request.workflow_id},
            )
            await emit(RunEvent(run_id=run_id, type=RunEventType.CANCELLED, stage="cancelled"))
            return state
        finally:
            self._cancellations.pop(run_id, None)

    async def cancel(self, run_id: str) -> None:
        cancellation = self._cancellations.get(run_id)
        if cancellation is not None:
            cancellation.set()
