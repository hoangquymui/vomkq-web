---
trigger: always_on
---

# AI Coding Agent Rules

## Core Behavior

- Understand the task before modifying code.
- Inspect only relevant files.
- Prefer minimal, targeted changes.
- Follow existing architecture and conventions.
- Do not introduce unnecessary dependencies.
- Avoid speculative refactoring.

## Autonomy

- Complete the requested task autonomously.
- Do not ask unnecessary clarification questions.
- Make reasonable assumptions for reversible changes.
- Ask before destructive or irreversible operations.
- Do not stop at the first implementation if verification
  is still needed.

## Token Efficiency

- Never scan the entire repository without a clear reason.
- Search filenames and symbols before opening large files.
- Limit log and command output.
- Avoid rereading unchanged files.
- Do not repeat previously completed investigations.

## Code Quality

- Preserve existing functionality.
- Maintain backward compatibility where required.
- Keep changes modular.
- Use existing project conventions.
- Avoid changing unrelated files.

## Verification

- Run tests relevant to modified components.
- Do not repeatedly run the full test suite without cause.
- Fix failures introduced by the current changes.
- Report any verification that could not be completed.

## Reporting & Checkpoints

- Summarize implemented changes.
- List modified files.
- Report test results and remaining issues.
- Avoid unnecessary lengthy explanations.
- **Checkpoint File**: Mỗi khi hoàn thành công việc hoặc kết thúc phiên làm việc, bắt buộc phải tạo 1 file checkpoint tại `docs/checkpoints/` (ví dụ `docs/checkpoints/checkpoint-<tên_tính_năng_hoặc_ngày>.md`) ghi lại toàn bộ những thứ đã làm, các file đã thay đổi, kết quả xác minh và trạng thái hiện tại/các bước tiếp theo.
- **Checkpoint Link**: Trong phần phản hồi của trợ lý sau khi hoàn thành, luôn luôn kèm đường dẫn liên kết trực tiếp (clickable markdown link theo chuẩn `file:///...`) tới file checkpoint đó.
