from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from typing import Any, TypeVar

from ..domain.models import ResourceLimits, ResourceRequest, WorkPriority

T = TypeVar("T")


class ResourceCapacityError(ValueError):
    """Raised when a request can never fit inside configured local limits."""


@dataclass(slots=True)
class _Waiter:
    request: ResourceRequest
    sequence: int


@dataclass(slots=True)
class _ActiveLease:
    request: ResourceRequest
    sequence: int


class ResourceManager:
    """One process-wide admission controller for CPU, RAM and GPU work.

    Priority is strict between classes and FIFO inside a class. A background job
    intentionally releases its lease between pages/batches so an interactive job
    can be admitted. Work already running is never force-preempted.
    """

    def __init__(self, limits: ResourceLimits) -> None:
        if limits.cpu_slots < 1 or limits.ram_mb < 0 or limits.gpu_mb < 0:
            raise ValueError("Invalid resource limits")
        self._limits = limits
        self._condition = asyncio.Condition()
        self._waiters: list[_Waiter] = []
        self._active: dict[int, _ActiveLease] = {}
        self._sequence = 0
        self._cpu_used = 0
        self._ram_used = 0
        self._gpu_used = 0
        self._exclusive_gpu_active = False

    @property
    def limits(self) -> ResourceLimits:
        return self._limits

    def _validate(self, request: ResourceRequest) -> None:
        if min(request.cpu_slots, request.ram_mb, request.gpu_mb) < 0:
            raise ResourceCapacityError("Resource amounts cannot be negative")
        if request.cpu_slots > self._limits.cpu_slots:
            raise ResourceCapacityError("Requested CPU slots exceed configured capacity")
        if request.ram_mb > self._limits.ram_mb:
            raise ResourceCapacityError("Requested RAM exceeds configured capacity")
        if request.gpu_mb > self._limits.gpu_mb:
            raise ResourceCapacityError("Requested GPU memory exceeds configured capacity")
        if request.exclusive_gpu and not self._limits.allow_exclusive_gpu:
            raise ResourceCapacityError("Exclusive GPU work is disabled by the local profile")

    def _fits(self, request: ResourceRequest) -> bool:
        if self._cpu_used + request.cpu_slots > self._limits.cpu_slots:
            return False
        if self._ram_used + request.ram_mb > self._limits.ram_mb:
            return False
        if request.exclusive_gpu:
            if self._exclusive_gpu_active or self._gpu_used > 0:
                return False
        elif request.gpu_mb and self._exclusive_gpu_active:
            return False
        return self._gpu_used + request.gpu_mb <= self._limits.gpu_mb

    def _first_waiter(self) -> _Waiter | None:
        if not self._waiters:
            return None
        return min(self._waiters, key=lambda item: (int(item.request.priority), item.sequence))

    async def acquire(self, request: ResourceRequest) -> int:
        self._validate(request)
        async with self._condition:
            self._sequence += 1
            waiter = _Waiter(request=request, sequence=self._sequence)
            self._waiters.append(waiter)
            try:
                await self._condition.wait_for(
                    lambda: self._first_waiter() is waiter and self._fits(request)
                )
            except BaseException:
                if waiter in self._waiters:
                    self._waiters.remove(waiter)
                    self._condition.notify_all()
                raise

            self._waiters.remove(waiter)
            lease_id = waiter.sequence
            self._active[lease_id] = _ActiveLease(request=request, sequence=lease_id)
            self._cpu_used += request.cpu_slots
            self._ram_used += request.ram_mb
            self._gpu_used += request.gpu_mb
            if request.exclusive_gpu:
                self._exclusive_gpu_active = True
            self._condition.notify_all()
            return lease_id

    async def release(self, lease_id: int) -> None:
        async with self._condition:
            active = self._active.pop(lease_id, None)
            if active is None:
                return
            request = active.request
            self._cpu_used -= request.cpu_slots
            self._ram_used -= request.ram_mb
            self._gpu_used -= request.gpu_mb
            if request.exclusive_gpu:
                self._exclusive_gpu_active = False
            self._condition.notify_all()

    @asynccontextmanager
    async def lease(self, request: ResourceRequest) -> AsyncIterator[None]:
        lease_id = await self.acquire(request)
        try:
            yield
        finally:
            await self.release(lease_id)

    async def snapshot(self) -> dict[str, Any]:
        async with self._condition:
            queued = sorted(
                self._waiters,
                key=lambda item: (int(item.request.priority), item.sequence),
            )
            return {
                "limits": asdict(self._limits),
                "used": {
                    "cpu_slots": self._cpu_used,
                    "ram_mb": self._ram_used,
                    "gpu_mb": self._gpu_used,
                    "exclusive_gpu": self._exclusive_gpu_active,
                },
                "active": [
                    {"lease_id": lease.sequence, **asdict(lease.request)}
                    for lease in self._active.values()
                ],
                "queued": [
                    {"sequence": waiter.sequence, **asdict(waiter.request)}
                    for waiter in queued
                ],
            }


class InferenceScheduler:
    """Runs all heavy local operations through a shared ResourceManager."""

    def __init__(self, resources: ResourceManager) -> None:
        self.resources = resources

    @staticmethod
    def _raise_if_cancelled(cancellation: asyncio.Event | None) -> None:
        if cancellation is not None and cancellation.is_set():
            raise asyncio.CancelledError

    @asynccontextmanager
    async def _lease(self, request: ResourceRequest, cancellation: asyncio.Event | None):
        acquire = asyncio.create_task(self.resources.acquire(request))
        cancelled = asyncio.create_task(cancellation.wait()) if cancellation else None
        lease_id = None
        try:
            if cancelled is not None:
                await asyncio.wait((acquire, cancelled), return_when=asyncio.FIRST_COMPLETED)
                self._raise_if_cancelled(cancellation)
            lease_id = await acquire
            self._raise_if_cancelled(cancellation)
            yield
        finally:
            if cancelled is not None:
                cancelled.cancel()
                await asyncio.gather(cancelled, return_exceptions=True)
            if not acquire.done():
                acquire.cancel()
            await asyncio.gather(acquire, return_exceptions=True)
            # Acquisition and cancellation can finish on the same event-loop
            # tick; release any granted lease even if its result wasn't awaited.
            if lease_id is None and not acquire.cancelled() and acquire.exception() is None:
                lease_id = acquire.result()
            if lease_id is not None:
                await self.resources.release(lease_id)

    async def run(
        self,
        request: ResourceRequest,
        factory: Callable[[], Awaitable[T]],
        *,
        cancellation: asyncio.Event | None = None,
    ) -> T:
        self._raise_if_cancelled(cancellation)
        async with self._lease(request, cancellation):
            self._raise_if_cancelled(cancellation)
            return await factory()

    async def stream(
        self,
        request: ResourceRequest,
        factory: Callable[[], AsyncIterator[T]],
        *,
        cancellation: asyncio.Event | None = None,
    ) -> AsyncIterator[T]:
        self._raise_if_cancelled(cancellation)
        async with self._lease(request, cancellation):
            self._raise_if_cancelled(cancellation)
            async for item in factory():
                self._raise_if_cancelled(cancellation)
                yield item

    async def cooperative_batches(
        self,
        request: ResourceRequest,
        batches: Iterable[T],
        worker: Callable[[T], Awaitable[Any]],
        *,
        cancellation: asyncio.Event | None = None,
    ) -> list[Any]:
        """Release resources after every OCR page/embedding/index batch."""
        results: list[Any] = []
        for batch in batches:
            self._raise_if_cancelled(cancellation)
            results.append(
                await self.run(
                    request,
                    lambda batch=batch: worker(batch),
                    cancellation=cancellation,
                )
            )
            await asyncio.sleep(0)  # explicit cooperative scheduling point
        return results
