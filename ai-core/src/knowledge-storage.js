import "./knowledge-storage.css";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export function openKnowledgeStorage({ request, onChanged, notify }) {
  const dialog = document.createElement("dialog");
  dialog.className = "knowledge-storage-dialog";
  dialog.innerHTML = `<header><h2>Lưu trữ tài liệu</h2><button data-close aria-label="Đóng">×</button></header><nav><button data-state="active" aria-pressed="false">Kho đang dùng</button><button data-state="archived" aria-pressed="true">Lưu trữ</button><button data-state="trashed" aria-pressed="false">Thùng rác</button></nav><p data-note></p><div data-items></div><p data-message role="status"></p><footer><button data-open-root>Mở thư mục trên máy</button><details><summary>Sao chép folder sang nơi khác</summary><label>Thư mục đích có sẵn trên máy<input data-destination placeholder="D:\\Tai_lieu" aria-label="Thư mục đích"></label><button data-export>Sao chép kho đang xem</button><small>Tạo một bản sao mới có ngày giờ, gồm nội dung và các folder con.</small></details></footer>`;
  document.body.append(dialog); dialog.showModal();
  const $ = (selector) => dialog.querySelector(selector);
  let state = "archived", busy = false;
  const status = (message) => { $("[data-message]").textContent = message; };
  async function render() {
    const result = await request(`/documents?state=${state}`);
    $("[data-note]").textContent = state === "active" ? "Các tài liệu trong Kho Kiến Thức hiện tại." : "Tài liệu ở đây được giữ để khôi phục và không dùng làm nguồn trả lời.";
    $("[data-items]").innerHTML = (result.documents || []).map((doc) => `<article><div><b>${esc(doc.title)}</b><small>${doc.chunk_count || 0} đoạn dữ liệu · v${doc.version}</small></div><button data-open="${esc(doc.id)}" data-version="${doc.version}">Mở folder</button>${state !== "active" ? `<button data-restore="${esc(doc.id)}" data-version="${doc.version}">Khôi phục</button>` : ""}</article>`).join("") || "<p>Chưa có tài liệu.</p>";
    dialog.querySelectorAll("[data-state]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.state === state)));
  }
  dialog.addEventListener("click", async (event) => {
    const button = event.target.closest("button"); if (!button || busy) return;
    if (button.hasAttribute("data-close")) { dialog.close(); return; }
    busy = true; dialog.setAttribute("aria-busy", "true");
    try {
      if (button.dataset.state) { state = button.dataset.state; await render(); }
      if (button.hasAttribute("data-open-root") || button.dataset.open) {
        const result = await request("/knowledge/storage/open", {method:"POST", body:{state, document_id:button.dataset.open, version:Number(button.dataset.version || 1)}});
        status(result.path);
      }
      if (button.dataset.restore) {
        const result = await request(`/documents/${encodeURIComponent(button.dataset.restore)}/lifecycle`, {method:"POST", body:{state:"active", version:Number(button.dataset.version)}});
        await render(); await onChanged?.(); status(result.storage?.warning || "Đã khôi phục tài liệu vào Kho Kiến Thức."); notify?.("Đã khôi phục tài liệu");
      }
      if (button.hasAttribute("data-export")) {
        status("Đang sao chép folder…");
        const result = await request("/knowledge/storage/export", {method:"POST", body:{state, destination:$("[data-destination]").value.trim()}, timeout:120000});
        status(`Đã lưu bản sao: ${result.path}`);
      }
    } catch (error) { status(error.message); }
    finally { busy = false; dialog.removeAttribute("aria-busy"); }
  });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove());
  render().catch((error) => status(error.message));
}
