# VECTOR AI Python backend

The Python package keeps domain and application logic independent from FastAPI,
Tauri, Ollama, Qdrant and LangGraph. Runtime dependencies are opt-in so the core
test suite can run without external services.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[api,math,dev]"
.venv\Scripts\python -m vector_ai_backend
```

Defaults are loopback-only: `VECTOR_AI_HOST=127.0.0.1` and
`VECTOR_AI_PORT=8000`. Ollama and Qdrant default to `127.0.0.1:11434` and
`127.0.0.1:6333` respectively.

Optional adapters:

```powershell
.venv\Scripts\python -m pip install -e ".[workflow,vector,embedding]"
```

Model assets must already exist locally. Runtime code never downloads them.

## Current implementation checkpoint

Implemented and covered by automated tests:

- Independent ingestion/query checkpoint namespaces, central resource admission,
  chat priority between background batches, cancellation and SSE replay.
- Tool allowlist/capability checks, restricted schema validation, bounded JSON
  payloads, output data validation and deadlines including resource queue time.
- SymPy tools run in disposable hidden child processes. Timeout/cancellation
  terminates only the owned worker. This is lifetime isolation, not an OS sandbox.
- Embedding generations retain an immutable profile snapshot; equal dimensions
  do not permit querying another embedding space. Live SQLite scope/verification
  metadata is checked again for dense results.
- Backup v2 validates paths/checksums/databases and stages Core replacement for
  restart. Frontend chat/file restore waits for the matching Core restore ID.
  Previous Core state remains under `restore_archives`; previous frontend state
  remains in IndexedDB `vector-ai-restore-journal-v2`.
- Legacy origin migration is available through `MIGRATE_LEGACY_DATA.bat`.
  Original storage is not deleted. Migration still needs a real desktop check.
- Ongoing chat/workspace snapshots now use `ConversationService` and SQLite
  `conversation_state` in `legacy_state.sqlite3` (kept there for backup compatibility).
  REST only translates requests; validation/CAS policy lives in Application.
  A revision conflict returns 409; retrying the last identical operation is
  idempotent. IDs, branch metadata and file references are preserved.
- The frontend loads the SQLite snapshot and queues writes durably in IndexedDB
  `vector-ai-conversation-outbox-v1`. LocalStorage remains a compatibility cache.
  Unsent/recovery data is retained; connection failures pause editing and provide
  retry/export. Conflicts require an explicit choice before keeping the server
  version. File bytes and some settings still live in the existing frontend stores.

The whole migration is **not complete**. Remaining work includes moving the
remaining document/profile route business logic to Application services,
desktop end-to-end validation of conversation migration/recovery, completing
formula-edit invalidation and validation edge cases, and real dense/OCR/offline
integration and performance tests. Do not treat fake-vector tests as a Qdrant
benchmark. Native Qdrant and local embedding/OCR model assets must be prepared
before those integrations can be verified. No 3D tools are implemented.

Regression commands from the project root:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests
node --test scripts/check_backup_restore.mjs scripts/check_conversation_persistence.mjs scripts/check_generation_status.mjs
.\backend\.venv\Scripts\python.exe scripts/run_runtime_checks.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Optional real-model smoke test (loads the selected local model; does not save a
conversation or change model settings):

```powershell
.\backend\.venv\Scripts\python.exe scripts/check_ollama_chat.py --model hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
```

Query assembly merges existing system instructions and retrieval context into
one initial system message for strict Qwen templates. HTTP and stream errors
retain bounded Ollama diagnostics; an early stream termination is not success.
The frontend labels a request as user-stopped only for a matching, nonempty
stop-request ID. A model error before the first token is not a cancellation.

Documents created/imported in the knowledge manager use shared `builtin` scope;
chat attachments retain their chat/workspace scope. Existing private documents
can be explicitly promoted with `POST /api/v1/documents/{id}/share` (`version`).
This preserves content and review state and invalidates retrieval caches.
The frontend defaults to document-only answers; the workflow configuration can
allow clearly labelled model knowledge, and workspaces can override the default.
`strict_sources` now reaches the actual model prompt. With no retrieved or inline
evidence, strict requests complete with a missing-information answer without
calling Ollama. Source citations use the same `[R1]` IDs as the frontend.
