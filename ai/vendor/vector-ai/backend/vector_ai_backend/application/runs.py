from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import AsyncIterator, Generic, TypeVar

from ..domain.models import DocumentIngestionState, QueryReasoningState, RunEvent, RunEventType
from ..domain.ports import DocumentIngestionRunner, QueryReasoningRunner, RunHistoryStore


TERMINAL = {RunEventType.COMPLETED, RunEventType.CANCELLED, RunEventType.ERROR}
State = TypeVar("State", QueryReasoningState, DocumentIngestionState)


class RunNotFoundError(KeyError):
    pass


@dataclass(slots=True)
class _RunRecord(Generic[State]):
    state: State
    history: list[RunEvent] = field(default_factory=list)
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    task: asyncio.Task[None] | None = None
    terminal: bool = False
    first_sequence: int = 0
    total_events: int = 0


class _Coordinator(Generic[State]):
    """Shared event mechanics; each graph owns its records and lifecycle."""

    kind: str

    def __init__(self, runner, history_limit: int = 2048, history_store: RunHistoryStore | None = None) -> None:
        self._runner = runner
        self._records: dict[str, _RunRecord[State]] = {}
        self._history_limit = max(16, history_limit)
        self._history_store = history_store
        self._closing = False

    def _run_id(self, state: State) -> str:
        return state.request.run_id if isinstance(state, QueryReasoningState) else state.run_id

    async def start(self, state: State) -> str:
        if self._closing:
            raise ValueError("Workflow coordinator is shutting down")
        run_id = self._run_id(state)
        if run_id in self._records:
            raise ValueError(f"Run already exists: {run_id}")
        # No await between duplicate check and registration.
        record = _RunRecord(state=state)
        self._records[run_id] = record
        record.task = asyncio.create_task(self._execute(record), name=f"vector-{self.kind}-{run_id}")
        return run_id

    async def _emit(self, record: _RunRecord[State], event: RunEvent) -> None:
        if record.terminal:
            return
        async with record.condition:
            record.history.append(event)
            record.total_events += 1
            excess = len(record.history) - self._history_limit
            if excess > 0:
                del record.history[:excess]
                record.first_sequence += excess
            record.terminal = event.type in TERMINAL
            if event.stage:
                record.state.stage = event.stage
            record.condition.notify_all()
        # Persist lifecycle/usage, not every generated token; this avoids a disk
        # transaction per token and never stores raw thinking.
        if self._history_store is not None and event.type is not RunEventType.DELTA:
            await self._history_store.record_run_event(self.kind, event)

    async def _execute(self, record: _RunRecord[State]) -> None:
        run_id = self._run_id(record.state)
        try:
            await self._runner.run(record.state, lambda event: self._emit(record, event))
            if not record.terminal:
                await self._emit(record, RunEvent(run_id, RunEventType.ERROR, "error",
                    message="Workflow ended without a terminal event"))
        except asyncio.CancelledError:
            await self._emit(record, RunEvent(run_id, RunEventType.CANCELLED, "cancelled"))
        except Exception as exc:
            await self._emit(record, RunEvent(run_id, RunEventType.ERROR, "error",
                message=str(exc), data={"error_type": type(exc).__name__}))

    async def cancel(self, run_id: str) -> bool:
        record = self._records.get(run_id)
        if record is None:
            raise RunNotFoundError(run_id)
        if record.terminal:
            return False
        await self._runner.cancel(run_id)
        # OCR/embedding running in a native thread finishes its current batch.
        # Cancelling that coroutine cannot actually stop the native worker.
        if self.kind == "query" and record.task and not record.task.done():
            record.task.cancel()
        return True

    async def close(self) -> None:
        self._closing = True
        for run_id, record in tuple(self._records.items()):
            if not record.terminal:
                await self.cancel(run_id)
        tasks = [record.task for record in self._records.values() if record.task]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def events(self, run_id: str) -> AsyncIterator[RunEvent]:
        record = self._records.get(run_id)
        if record is None:
            raise RunNotFoundError(run_id)
        cursor = 0
        while True:
            async with record.condition:
                await record.condition.wait_for(lambda: cursor < record.total_events or record.terminal)
                if cursor < record.first_sequence:
                    batch = [RunEvent(run_id, RunEventType.ERROR, "stream",
                        message="Event history expired; reload the run instead of replaying a partial answer.",
                        data={"code": "event_history_expired"})]
                else:
                    batch = list(record.history[cursor - record.first_sequence:])
                cursor = record.total_events
                terminal = record.terminal
            for event in batch:
                yield event
                if event.type in TERMINAL:
                    return
            if terminal:
                return

    def snapshot(self, run_id: str) -> tuple[RunEvent, ...]:
        record = self._records.get(run_id)
        if record is None:
            raise RunNotFoundError(run_id)
        return tuple(record.history)

    def has(self, run_id: str) -> bool:
        return run_id in self._records

    def active(self) -> bool:
        return any(record.task and not record.task.done() for record in self._records.values())

    async def summaries(self) -> list[dict[str, object]]:
        if self._history_store is not None:
            rows = [dict(item) for item in await self._history_store.list_run_summaries()
                    if item.get("kind") == self.kind]
            for row in rows:
                record = self._records.get(str(row["run_id"]))
                if record:
                    row.update(stage=record.state.stage, terminal=record.terminal)
                elif not row["terminal"]:
                    row.update(stage="interrupted", terminal=True)
            return rows
        return [{"run_id": run_id, "kind": self.kind, "stage": record.state.stage,
                 "terminal": record.terminal, "events": record.total_events}
                for run_id, record in reversed(tuple(self._records.items()))]


class RunCoordinator(_Coordinator[QueryReasoningState]):
    """Independent query runs, cancellation and events."""
    kind = "query"


class IngestionRunCoordinator(_Coordinator[DocumentIngestionState]):
    """Independent document runs; cancellation takes effect at batch boundaries."""
    kind = "ingestion"

    def active_for_document(self, document_id: str) -> bool:
        return any(record.state.document_id == document_id and record.task and not record.task.done()
                   for record in self._records.values())
