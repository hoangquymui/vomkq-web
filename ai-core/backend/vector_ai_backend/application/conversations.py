"""Transport-independent persistence for existing chat/workspace documents.

The current frontend shape is preserved, including branch/message IDs and
attachment references. Normalized per-message storage can migrate it later.
"""
from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ..domain.ports import ConversationStore


class ConversationConflict(ValueError):
    pass


class ConversationService:
    def __init__(self, store: ConversationStore) -> None:
        self.store = store

    async def read(self) -> Mapping[str, Any]:
        return await self.store.read_conversation_state()

    async def save(self, payload: Mapping[str, Any], *, expected_revision: int, operation_id: str) -> Mapping[str, Any]:
        if type(expected_revision) is not int or expected_revision < 0:
            raise ValueError("Revision không hợp lệ")
        if not isinstance(operation_id, str) or not 1 <= len(operation_id) <= 100:
            raise ValueError("Operation ID không hợp lệ")
        if not isinstance(payload, dict):
            raise ValueError("Dữ liệu hội thoại phải là object")
        if not isinstance(payload.get("generalChats"), list) or not isinstance(payload.get("workspaces"), list):
            raise ValueError("Thiếu danh sách chat hoặc workspace")
        try:
            encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        except (ValueError, TypeError, RecursionError) as exc:
            raise ValueError("Dữ liệu hội thoại không phải JSON hợp lệ") from exc
        if len(encoded.encode("utf-8")) > 32 * 1024 * 1024:
            raise ValueError("Dữ liệu hội thoại vượt giới hạn 32 MB")
        chat_ids, workspace_ids = set(), set()

        def require_id(row, seen, kind):
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]:
                raise ValueError(f"{kind} thiếu ID")
            if row["id"] in seen:
                raise ValueError(f"Trùng ID {kind}: {row['id']}")
            seen.add(row["id"])

        def chats(rows):
            if not isinstance(rows, list):
                raise ValueError("Danh sách chat không hợp lệ")
            for chat in rows:
                require_id(chat, chat_ids, "chat")
                if not isinstance(chat.get("messages"), list):
                    raise ValueError("Chat thiếu danh sách tin nhắn")
                message_ids = set()
                for message in chat["messages"]:
                    if not isinstance(message, dict) or message.get("role") not in {"user", "assistant", "system", "tool"}:
                        raise ValueError("Tin nhắn không hợp lệ")
                    # Older chat backups have messages without IDs. Preserve
                    # those rather than invent IDs or discard content.
                    if "id" in message:
                        require_id(message, message_ids, "tin nhắn")

        chats(payload["generalChats"])
        for workspace in payload["workspaces"]:
            require_id(workspace, workspace_ids, "workspace")
            chats(workspace.get("chats", []))
        active = payload.get("activeWorkspaceId")
        if active not in (None, "general") and active not in workspace_ids:
            raise ValueError("Workspace đang chọn không tồn tại")
        result = await self.store.write_conversation_state(json.loads(encoded), expected_revision, operation_id)
        if result is None:
            raise ConversationConflict("Dữ liệu đã thay đổi ở cửa sổ khác. Không ghi đè phiên bản mới hơn.")
        return result
