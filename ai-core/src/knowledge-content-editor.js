import "katex/dist/katex.min.css";
import "./knowledge-content.css";
import { escapeContent as esc, parseKnowledge, serializeKnowledge, renderKnowledge, renderFormula, renderTableCell, formulaFromInput, parseTablePaste, tableCells, tableCellSource, normalizeTableRows, tableRegions, mergeTableRange, splitTableRange, splitTableAnchor, escapeMergeMarker } from "./knowledge-content.js";
import { MATH_SYMBOL_GROUPS, insertionFor } from "./math-symbol-library.js";

// Native modal keeps keyboard/focus away from the underlying chat and dialogs.
export function openKnowledgeContent({ title = "", source = "", editable = false, startEditing = false, saveLabel = "Lưu dữ liệu", emptySaveLabel = "", allowEmpty = false, note = "", onSave } = {}) {
  const dialog = document.createElement("dialog"); dialog.className = "knowledge-document-dialog";
  const id = `knowledge-${crypto.randomUUID()}`;
  dialog.setAttribute("aria-labelledby", id);
  dialog.innerHTML = `<header><div><small>VECTOR AI · DỮ LIỆU</small><h2 id="${id}">${editable ? "Soạn dữ liệu" : "Nội dung tài liệu"}</h2></div><button type="button" data-close aria-label="Đóng trình soạn">×</button></header>
    <label class="knowledge-document-title">Tên tài liệu / đoạn<input data-title maxlength="120" ${editable ? "" : "readonly"} value="${esc(title)}"></label>
    <p class="knowledge-document-note">${esc(note || "Hiển thị và soạn nội dung ngay trên máy. Xem trước không đồng nghĩa công thức đã được kiểm chứng.")}</p>
    <nav aria-label="Cách xem dữ liệu"><button type="button" data-mode="preview">Bản trình bày</button>${editable ? '<button type="button" data-mode="edit">Soạn trực quan</button>' : ""}<button type="button" data-mode="source">${editable ? "Markdown / LaTeX (nâng cao)" : "Văn bản gốc"}</button>${editable ? '<button type="button" data-symbols>Ω Ký hiệu & công thức</button>' : ""}<button type="button" data-undo ${editable ? "" : "hidden"}>↶ Hoàn tác</button></nav>
    <div class="knowledge-document-body" data-body></div>
    <section class="knowledge-symbol-library" data-symbol-library hidden aria-label="Thư viện ký hiệu và công thức"><header><div><small>THƯ VIỆN CHÈN</small><h3>Ký hiệu & công thức</h3></div><button type="button" data-close-symbols aria-label="Đóng thư viện">×</button></header><p>Chọn một mục để chèn tại con trỏ. Trong ô bảng, mẫu công thức sẽ tự được bọc bằng <code>$...$</code>.</p><label>Tìm ký hiệu hoặc công thức<input type="search" data-symbol-search placeholder="Ví dụ: alpha, tích phân, ≤…"></label><div class="knowledge-symbol-groups" data-symbol-groups></div><div class="knowledge-symbol-target" data-symbol-target></div><div class="knowledge-symbol-grid" data-symbol-results></div></section>
    <div class="knowledge-discard" data-discard hidden>Bỏ các thay đổi chưa lưu?<button type="button" data-keep>Tiếp tục sửa</button><button type="button" data-discard-confirm>Bỏ thay đổi</button></div>
    <footer><span data-status role="status" aria-live="polite"></span><button type="button" data-download>Tải bản .md</button>${editable ? `<button type="button" data-save class="knowledge-primary">${esc(!source.trim() && emptySaveLabel ? emptySaveLabel : saveLabel)}</button>` : ""}</footer>`;
  document.body.append(dialog);
  const $ = (s) => dialog.querySelector(s), body = $("[data-body]");
  let blocks = parseKnowledge(source), mode = startEditing && editable ? "edit" : "preview", saving = false, timer, lastEdit, undo = [];
  let activeInput = null, symbolGroup = "popular";
  let cellAnchor = null, cellSelection = null;
  const pendingMath = new Set(), mathRevisions = new WeakMap();
  const cellPreview = (cell) => {
    const html = renderTableCell(cell);
    return html.includes('class="knowledge-inline-math"') ? html : "";
  };
  // Merged regions are stored as markers in the same pipe table, so the editor
  // paints the highlight from the logical selection rectangle rather than the DOM.
  const inSelection = (cell) => Boolean(cellSelection?.range) && cell.block === cellSelection.block
    && cell.r >= cellSelection.top && cell.r <= cellSelection.bottom && cell.c >= cellSelection.left && cell.c <= cellSelection.right;
  const paintSelection = () => {
    body.querySelectorAll(".knowledge-cell-selected").forEach((node) => node.classList.remove("knowledge-cell-selected"));
    if (!cellSelection?.range) return;
    body.querySelectorAll(`[data-block="${cellSelection.block}"] [data-cell]`).forEach((input) => {
      const [r, c] = input.dataset.cell.split(":").map(Number);
      if (inSelection({ block: cellSelection.block, r, c })) input.closest("th,td")?.classList.add("knowledge-cell-selected");
    });
  };
  const initial = source, initialTitle = title;
  const value = () => serializeKnowledge(blocks);
  const updateSaveLabel = () => { const button = $("[data-save]"); if (button) button.textContent = !value().trim() && emptySaveLabel ? emptySaveLabel : saveLabel; };
  const dirty = () => blocks.some((block) => block.simplePending || block.simpleError) || value() !== initial || $("[data-title]").value !== initialTitle;
  const status = (message, error = false) => { $("[data-status]").textContent = message; $("[data-status]").classList.toggle("error", error); };
  const remember = (key) => {
    if (lastEdit === key) return;
    undo.push(structuredClone(blocks));
    while (undo.length > 1 && (undo.length > 20 || JSON.stringify(undo).length > 2_000_000)) undo.shift();
    lastEdit = key; $("[data-undo]").disabled = !undo.length;
  };
  const finish = () => { clearTimeout(timer); dialog.close(); dialog.remove(); };
  const close = () => { if (saving) return; if (editable && dirty()) { $("[data-discard]").hidden = false; $("[data-keep]").focus(); } else finish(); };
  const updatePreview = (index) => {
    const block = blocks[index], target = body.querySelector(`[data-block="${index}"] [data-block-preview]`);
    if (target) target.innerHTML = block.type === "formula" ? renderFormula(block.latex) : renderKnowledge(serializeKnowledge([block]));
  };
  const convertFormula = (block, index, text) => {
    const revision = (mathRevisions.get(block) || 0) + 1;
    mathRevisions.set(block, revision); block.simplePending = true; block.simpleError = "";
    const task = formulaFromInput(text).then((latex) => {
      if (mathRevisions.get(block) !== revision || !blocks.includes(block)) return;
      block.latex = latex; block.simplePending = false; block.dirty = true;
      if (!dialog.isConnected) return;
      const field = body.querySelector(`[data-block="${index}"] [data-latex]`);
      if (field) field.value = latex;
      updatePreview(index); updateSaveLabel(); status("Công thức đã cập nhật tự động · chưa lưu");
    }).catch((error) => {
      if (mathRevisions.get(block) !== revision || !blocks.includes(block)) return;
      block.simplePending = false; block.simpleError = error.message || String(error);
      if (!dialog.isConnected) return;
      const preview = body.querySelector(`[data-block="${index}"] [data-block-preview]`);
      if (preview) preview.innerHTML = '<p class="knowledge-document-note">Biểu thức chưa hoàn chỉnh. Tiếp tục nhập để xem công thức.</p>';
      status("Biểu thức chưa hoàn chỉnh; bản nhập vẫn được giữ.", true);
    });
    pendingMath.add(task); task.finally(() => pendingMath.delete(task));
    return task;
  };
  const targetLabel = () => {
    if (!activeInput?.isConnected) return "Chưa chọn vị trí chèn";
    if (activeInput.matches("[data-cell]")) {
      const [row, column] = activeInput.dataset.cell.split(":").map((value) => Number(value) + 1);
      return `Đang chèn vào ô bảng · hàng ${row}, cột ${column}`;
    }
    if (activeInput.matches("[data-latex]")) return "Đang chèn vào công thức LaTeX";
    if (activeInput.matches("[data-simple]")) return "Đang chèn vào biểu thức toán thông thường";
    if (activeInput.matches("[data-source-input]")) return "Đang chèn vào Markdown / LaTeX";
    return "Đang chèn vào nội dung văn bản";
  };
  const drawSymbols = () => {
    const library = $(`[data-symbol-library]`); if (!library) return;
    const query = $(`[data-symbol-search]`)?.value.trim().toLocaleLowerCase("vi") || "";
    $(`[data-symbol-groups]`).innerHTML = MATH_SYMBOL_GROUPS.map((group) => `<button type="button" data-symbol-group="${group.id}" class="${symbolGroup === group.id ? "active" : ""}">${esc(group.label)}</button>`).join("");
    const groups = query ? MATH_SYMBOL_GROUPS : MATH_SYMBOL_GROUPS.filter((group) => group.id === symbolGroup);
    const items = groups.flatMap((group) => group.items.map((item, index) => ({ group, item, index }))).filter(({ item }) => !query || item.search.includes(query));
    $(`[data-symbol-target]`).textContent = targetLabel();
    $(`[data-symbol-results]`).innerHTML = items.map(({ group, item, index }) => `<button type="button" data-symbol-item="${group.id}:${index}" title="${esc(item.label)} · ${esc(item.latex)}"><b>${esc(item.symbol)}</b><span>${esc(item.label)}</span></button>`).join("") || "<p>Không tìm thấy ký hiệu phù hợp.</p>";
  };
  const openSymbols = (preferred = null) => {
    if (preferred?.isConnected) activeInput = preferred;
    if (!activeInput?.isConnected) activeInput = body.querySelector("[data-cell],[data-latex],[data-text],[data-source-input],[data-simple]");
    $(`[data-symbol-library]`).hidden = false; drawSymbols(); $(`[data-symbol-search]`).focus();
  };

  function draw() {
    clearTimeout(timer); lastEdit = null; cellAnchor = null; cellSelection = null;
    updateSaveLabel();
    dialog.querySelectorAll("[data-mode]").forEach((b) => { const active = mode === b.dataset.mode; b.classList.toggle("active", active); b.setAttribute("aria-pressed", String(active)); });
    $("[data-undo]").disabled = !undo.length;
    if (mode === "preview") { body.innerHTML = `<article class="knowledge-rich-content">${renderKnowledge(value()) || '<p class="knowledge-empty">Chưa có nội dung. Chọn Soạn trực quan để thêm văn bản, công thức hoặc bảng.</p>'}</article>`; return; }
    if (mode === "source") { body.innerHTML = `<p class="knowledge-document-note">${editable ? "Mã nguồn là chế độ tùy chọn. Có thể chuyển lại Soạn trực quan bất cứ lúc nào." : "Bản gốc chỉ đọc; hiển thị không thay đổi dữ liệu lưu trữ."}</p><textarea class="knowledge-source-input" data-source-input aria-label="Nội dung Markdown và LaTeX" spellcheck="false" ${editable ? "" : "readonly"}>${esc(value())}</textarea>`; return; }
    body.innerHTML = `<div class="knowledge-insert-bar"><span>Thêm nội dung</span><button type="button" data-add="text">＋ Văn bản</button><button type="button" data-add="formula">＋ Công thức</button><button type="button" data-add="table">＋ Bảng</button></div><div data-blocks>${blocks.map((b, index) => {
      if (b.type === "space") return "";
      const label = { formula: "Công thức", table: "Bảng dữ liệu", code: "Khối mã nguồn", text: "Văn bản" }[b.type];
      let editor = "";
      if (b.type === "table" && Math.max(...b.rows.map((r) => r.length)) <= 60 && b.rows.length <= 200) {
        const width = Math.max(...b.rows.map((r) => r.length));
        const { covered, invalid, regions } = tableRegions(b.rows);
        const anchors = new Map(regions.map((region) => [`${region.top}:${region.left}`, region]));
        const grid = b.rows.map((row, r) => `<tr>${Array.from({ length: width }, (_, c) => {
          const key = `${r}:${c}`;
          if (covered.has(key)) return ""; // The anchor's spans cover this cell.
          const region = anchors.get(key), merged = Boolean(region) && (region.colSpan > 1 || region.rowSpan > 1);
          const span = region ? `${region.colSpan > 1 ? ` colspan="${region.colSpan}"` : ""}${region.rowSpan > 1 ? ` rowspan="${region.rowSpan}"` : ""}` : "";
          const value = invalid.has(key) ? "" : (row[c] || "");
          const label = `Hàng ${r + 1}, cột ${c + 1}${merged ? `, ô gộp ${region.colSpan}×${region.rowSpan}` : ""}`;
          const selected = inSelection({ block: index, r, c }) ? " knowledge-cell-selected" : "";
          const style = `${merged ? " knowledge-merged-cell" : ""}${selected}`.trim();
          return `<${r ? "td" : "th"}${span}${style ? ` class="${style}"` : ""}><textarea rows="2" data-cell="${key}" aria-label="${label}" spellcheck="false">${esc(value)}</textarea><div class="knowledge-cell-preview knowledge-rich-content" data-cell-preview="${key}" aria-label="Xem trước ô">${cellPreview(value)}</div></${r ? "td" : "th"}>`;
        }).join("")}</tr>`).join("");
        editor = `<p class="knowledge-document-note">Hàng đầu là tiêu đề. Enter để xuống dòng trong ô; Tab sang ô tiếp theo. Dấu / chỉ là ký tự thường trong ô; muốn phân số thật, dùng Ω Chèn vào ô → Phân số (chia phần). Có thể dán vùng ô từ Excel (tối đa 200 hàng × 60 cột). Bấm một ô rồi giữ Shift và bấm ô cuối để chọn vùng cho ⧉ Gộp ô (hoặc Ctrl+G); ⧈ Tách ô (hoặc Ctrl+T) tách ô gộp đang bấm hoặc mọi ô gộp trong vùng chọn. Alt+H thêm hàng cuối và Alt+C thêm cột cuối, giống nút ＋ Hàng / ＋ Cột. Gõ \\&lt;&lt; hay \\^^ để hiện đúng hai ký tự đó trong ô.</p><div class="knowledge-table-scroll"><table class="knowledge-edit-table"><tbody>${grid}</tbody></table></div><div class="knowledge-block-tools"><button type="button" data-symbols>Ω Chèn vào ô</button><button type="button" data-merge>⧉ Gộp ô</button><button type="button" data-split>⧈ Tách ô</button><button type="button" data-row ${b.rows.length >= 200 ? "disabled" : ""}>＋ Hàng</button><button type="button" data-column ${width >= 60 ? "disabled" : ""}>＋ Cột</button><button type="button" data-trim-row ${b.rows.length <= 1 ? "disabled" : ""}>− Hàng cuối</button><button type="button" data-trim-column ${width <= 1 ? "disabled" : ""}>− Cột cuối</button></div>`;
      } else if (b.type === "formula") {
        editor = `<div class="knowledge-rich-content" data-block-preview>${b.simpleError ? '<p class="knowledge-document-note">Biểu thức chưa hoàn chỉnh. Tiếp tục nhập để xem công thức.</p>' : renderFormula(b.latex)}</div><label>Nhập toán — tự hiển thị khi gõ (ví dụ: 10w/57kt, (a+b)/c, sqrt(x))<div class="knowledge-formula-input"><input data-simple aria-label="Biểu thức toán thông thường" placeholder="10w/57kt" value="${esc(b.simpleInput || "")}"><button type="button" data-convert>Cập nhật</button></div></label><div class="knowledge-block-tools"><span>Chèn mẫu:</span><button type="button" data-insert="fraction">Phân số</button><button type="button" data-insert="sqrt">Căn √</button><button type="button" data-insert="power">Lũy thừa</button><button type="button" data-insert="subscript">Chỉ số dưới</button></div><div class="knowledge-template-builder" data-template-builder hidden></div><details class="knowledge-latex-details"><summary>Sửa LaTeX / ghép công thức nâng cao</summary><textarea data-latex spellcheck="false" aria-label="LaTeX công thức">${esc(b.latex)}</textarea><p class="knowledge-document-note">Mẫu được chèn vào vị trí con trỏ trong LaTeX (hoặc cuối công thức nếu chưa chọn vị trí). Chỉ kiểm tra khả năng hiển thị, không tự tính lại.</p></details>`;
      } else if (b.type === "table") {
        editor = `<p>Bảng quá lớn để sửa từng ô an toàn. Dùng tab Markdown / LaTeX; dữ liệu không bị cắt.</p><pre>${esc(b.raw)}</pre>`;
      } else {
        editor = `<label>Nội dung<textarea data-text aria-label="Nội dung văn bản" spellcheck="false">${esc(b.text)}</textarea></label><details><summary>Xem trước đoạn</summary><div class="knowledge-rich-content" data-block-preview>${renderKnowledge(serializeKnowledge([b]))}</div></details>`;
      }
      return `<section class="knowledge-edit-block" data-block="${index}"><header><b>${label}</b><button type="button" data-remove aria-label="Xóa khối ${label}">×</button></header>${editor}</section>`;
    }).join("")}</div>`;
  }

  function add(type) {
    remember(crypto.randomUUID());
    if (blocks.length && !value().endsWith("\n\n")) blocks.push({ type: "space", raw: "\n\n" });
    blocks.push({ type, text: "", raw: "", dirty: true, ...(type === "formula" ? { latex: "" } : type === "table" ? { rows: [["", ""], ["", ""]], align: ["left", "left"] } : {}) });
    draw(); const target = body.querySelector(`[data-block="${blocks.length - 1}"]`); target?.scrollIntoView({ block: "nearest" }); target?.querySelector("input,textarea")?.focus({ preventScroll: true });
  }

  // ⧉ Gộp ô and ⧈ Tách ô are reached from the toolbar buttons and from the
  // Ctrl/Cmd+G and Ctrl/Cmd+T shortcuts, so both call this single path: messages,
  // errors, undo snapshot and redraw stay byte-identical and cannot drift.
  const tableCommand = (index, merge) => {
    const block = blocks[index];
    if (!block || block.type !== "table") return;
    const selection = cellSelection?.block === index ? cellSelection : null;
    if (merge) {
      if (!selection) throw new Error("Hãy bấm một ô rồi giữ Shift và bấm ô cuối để chọn vùng cần gộp.");
      const cells = (selection.bottom - selection.top + 1) * (selection.right - selection.left + 1);
      if (cells < 2) throw new Error("Chọn ít nhất hai ô để gộp.");
      remember(crypto.randomUUID());
      block.rows = mergeTableRange(block.rows, selection);
      block.dirty = true; updatePreview(index); draw(); status("Đã gộp ô · chưa lưu. Có thể Hoàn tác."); return;
    }
    // A range splits every region it intersects; without a range the single
    // clicked cell is enough, so the promised click flow really exists.
    const anchor = cellAnchor?.block === index ? cellAnchor : null;
    if (!selection && !anchor) throw new Error("Hãy bấm vào ô gộp cần tách, hoặc giữ Shift và bấm ô cuối để chọn vùng chứa ô gộp.");
    const split = selection ? splitTableRange(block.rows, selection) : splitTableAnchor(block.rows, anchor);
    if (!split) {
      if (!selection) { status("Ô này không nằm trong vùng gộp nào."); return; }
      throw new Error("Vùng chọn không có ô gộp nào để tách.");
    }
    remember(crypto.randomUUID());
    block.rows = split;
    block.dirty = true; updatePreview(index); draw(); status("Đã tách ô · chưa lưu. Có thể Hoàn tác.");
  };

  // One action name per toolbar attribute keeps the buttons and the shortcuts in
  // step: adding a button or a keybinding means adding one entry, not one branch.
  const TABLE_RESIZE_ACTIONS = { "data-row": "row", "data-column": "column", "data-trim-row": "trim-row", "data-trim-column": "trim-column" };
  // ＋ Hàng, ＋ Cột, − Hàng cuối and − Cột cuối run through this single path, so the
  // toolbar buttons and the Alt+H / Alt+C shortcuts push exactly one undo step,
  // redraw the same grid and print the same status. At the 200 × 60 limit the
  // caller gets a real error instead of a silent no-op and no empty undo step.
  const tableResize = (index, action) => {
    const block = blocks[index];
    if (!block || block.type !== "table") return;
    const width = Math.max(...block.rows.map((row) => row.length));
    if (action === "row" && block.rows.length >= 200) throw new Error("Bảng đã đạt giới hạn 200 hàng.");
    if (action === "column" && width >= 60) throw new Error("Bảng đã đạt giới hạn 60 cột.");
    remember(crypto.randomUUID());
    if (action === "row") block.rows.push(Array(width).fill("")); // Empty cells, as wide as the table.
    if (action === "column") block.rows.forEach((row) => { while (row.length < width + 1) row.push(""); });
    if (action === "trim-row" && block.rows.length > 1) block.rows.pop();
    if (action === "trim-column" && width > 1) block.rows.forEach((row) => row.splice(width - 1));
    // Removing rows/columns can orphan a marker; repairing keeps the grid valid.
    block.rows = normalizeTableRows(block.rows);
    block.dirty = true; draw(); status("Đã sửa bảng · chưa lưu. Có thể Hoàn tác.");
  };

  dialog.addEventListener("input", (event) => {
    if (!editable || saving) return;
    const target = event.target, index = Number(target.closest("[data-block]")?.dataset.block), block = blocks[index];
    let hint = "";
    if (target.matches("[data-symbol-search]")) { drawSymbols(); return; }
    if (target.matches("[data-source-input]")) { remember("source"); blocks = parseKnowledge(target.value); }
    else if (block && target.matches("[data-simple]")) {
      remember(`${index}:simple`); block.simpleInput = target.value; block.dirty = true;
      convertFormula(block, index, target.value);
      updateSaveLabel(); status("Đang dựng công thức…"); return;
    }
    else if (block && target.matches("[data-text],[data-latex],[data-cell]")) {
      remember(`${index}:${target.getAttribute("data-cell") || target.tagName + (target.hasAttribute("data-latex") ? "latex" : "text")}`);
      if (target.hasAttribute("data-cell")) {
        const [r, c] = target.dataset.cell.split(":").map(Number);
        // A whole-cell marker typed by hand is ordinary text, never a merge: kept
        // raw it would join the region and dissolve real merges on the next render
        // (the serializer already writes it escaped, so this keeps both in step).
        const cell = escapeMergeMarker(target.value);
        if (cell !== target.value) { target.value = cell; hint = `Đã giữ ${cell.slice(1)} dạng văn bản. Dùng ⧉ Gộp ô để gộp vùng ô.`; }
        block.rows[r][c] = cell;
        target.nextElementSibling.innerHTML = cellPreview(cell);
      }
      else if (target.hasAttribute("data-latex")) {
        mathRevisions.set(block, (mathRevisions.get(block) || 0) + 1);
        block.latex = target.value; block.simpleInput = ""; block.simplePending = false; block.simpleError = "";
        const simple = target.closest("[data-block]").querySelector("[data-simple]"); if (simple) simple.value = "";
      }
      else block.text = target.value;
      block.dirty = true; clearTimeout(timer); timer = setTimeout(() => updatePreview(index), 150);
    }
    updateSaveLabel(); status(hint || (dirty() ? "Bản nháp · chưa lưu" : ""));
  });
  dialog.addEventListener("beforeinput", (event) => { if (saving) event.preventDefault(); });

  dialog.addEventListener("paste", (event) => {
    const target = event.target;
    if (!target.matches("[data-cell]") || saving) return;
    const text = event.clipboardData?.getData("text/plain") || "";
    const spreadsheet = /\t/.test(text) || /<table[\s>]/i.test(event.clipboardData?.getData("text/html") || "") || /^"[\s\S]*"\r?\n?$/.test(text);
    if (!spreadsheet) return; // Ordinary multi-line prose stays in this cell.
    event.preventDefault();
    const index = Number(target.closest("[data-block]").dataset.block), block = blocks[index];
    const [r0, c0] = target.dataset.cell.split(":").map(Number);
    let pasted;
    try { pasted = parseTablePaste(text); } catch (error) { status(error.message, true); return; }
    if (r0 + pasted.length > 200 || c0 + Math.max(...pasted.map((r) => r.length)) > 60) { status("Vùng dán vượt 200 hàng × 60 cột. Chưa thay đổi bảng.", true); return; }
    remember(crypto.randomUUID());
    pasted.forEach((row, r) => row.forEach((cell, c) => { block.rows[r0 + r] ||= []; block.rows[r0 + r][c0 + c] = cell; }));
    block.rows = normalizeTableRows(block.rows); // A pasted marker must never leave the grid invalid.
    block.dirty = true; draw(); status("Đã dán các ô · chưa lưu");
  });

  // A plain click anchors the next Shift+click; Shift+click paints the rectangle.
  dialog.addEventListener("mousedown", (event) => {
    const input = event.target.closest?.("[data-cell]");
    if (!input || !editable || saving || event.button !== 0) return;
    const index = Number(input.closest("[data-block]")?.dataset.block);
    const [r, c] = input.dataset.cell.split(":").map(Number);
    if (event.shiftKey && cellAnchor?.block === index) {
      event.preventDefault(); // Keep the browser from dragging a text selection across cells.
      cellSelection = { block: index, top: Math.min(cellAnchor.r, r), left: Math.min(cellAnchor.c, c), bottom: Math.max(cellAnchor.r, r), right: Math.max(cellAnchor.c, c), range: true };
    } else {
      cellSelection = null; // A plain click clears any range and only moves the anchor.
      cellAnchor = { block: index, r, c };
    }
    paintSelection();
  });

  dialog.addEventListener("click", async (event) => {
    const button = event.target.closest("button"); if (!button || saving) return;
    let ownsSave = false;
    try {
      if (!button.matches("[data-close],[data-discard-confirm],[data-keep]")) while (pendingMath.size) await Promise.all([...pendingMath]);
      if (!dialog.isConnected || saving) return;
      if (button.hasAttribute("data-close")) return close();
      if (button.hasAttribute("data-close-symbols")) { $(`[data-symbol-library]`).hidden = true; activeInput?.focus(); return; }
      if (button.dataset.symbolGroup) { symbolGroup = button.dataset.symbolGroup; drawSymbols(); return; }
      if (button.dataset.symbolItem) {
        if (!activeInput?.isConnected) throw new Error("Hãy đặt con trỏ vào văn bản, công thức hoặc một ô bảng trước khi chèn.");
        const [groupId, itemIndex] = button.dataset.symbolItem.split(":");
        const item = MATH_SYMBOL_GROUPS.find((group) => group.id === groupId)?.items[Number(itemIndex)];
        if (!item) return;
        const inserted = insertionFor(item, activeInput), start = activeInput.selectionStart ?? activeInput.value.length, end = activeInput.selectionEnd ?? start;
        activeInput.focus(); activeInput.setRangeText(inserted, start, end, "end");
        activeInput.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: inserted }));
        drawSymbols(); status(`Đã chèn ${item.label} · chưa lưu`); return;
      }
      if (button.hasAttribute("data-discard-confirm")) return finish();
      if (button.hasAttribute("data-keep")) { $("[data-discard]").hidden = true; return; }
      if (button.dataset.mode) {
        if (blocks.some((block) => block.simpleError)) throw new Error("Biểu thức đang nhập chưa hoàn chỉnh. Sửa công thức hoặc Hoàn tác trước khi đổi chế độ.");
        mode = button.dataset.mode; draw(); return;
      }
      if (button.hasAttribute("data-symbols")) {
        const section = button.closest("[data-block]");
        const preferred = section?.contains(activeInput) ? activeInput : (section?.querySelector("[data-cell],[data-latex],[data-text],[data-simple]") ?? null);
        openSymbols(preferred); return;
      }
      if (button.hasAttribute("data-undo")) {
        if (undo.length) blocks = undo.pop();
        blocks.forEach((block, index) => { if (block.simplePending) convertFormula(block, index, block.simpleInput || ""); });
        draw(); status("Đã hoàn tác nội dung"); return;
      }
      if (button.dataset.add) { add(button.dataset.add); return; }
      if (button.hasAttribute("data-download")) {
        if (blocks.some((block) => block.simpleError)) throw new Error("Có biểu thức chưa hoàn chỉnh. Sửa công thức hoặc Hoàn tác trước khi tải bản .md.");
        const url = URL.createObjectURL(new Blob([value()], { type: "text/markdown;charset=utf-8" }));
        const a = document.createElement("a"); a.href = url; a.download = ($("[data-title]").value || "du-lieu").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) + ".md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      if (button.hasAttribute("data-save")) {
        if (blocks.some((block) => block.simpleError)) throw new Error("Có biểu thức chưa hoàn chỉnh. Sửa công thức hoặc Hoàn tác trước khi lưu.");
        if (!$("[data-title]").value.trim()) throw new Error("Nhập tên tài liệu trước khi lưu.");
        if (!allowEmpty && !value().trim()) throw new Error("Nhập nội dung trước khi lưu.");
        if (blocks.some((block) => block.type === "formula" && block.dirty && !block.latex.trim())) throw new Error("Có khối công thức còn trống. Hãy nhập công thức hoặc xóa khối trống.");
        // Newlines are encoded as safe <br> markers within a Markdown row.
        for (const block of blocks) if (block.type === "table" && block.dirty) {
          for (const row of block.rows) for (const cell of row) {
            if (cell && tableCells(`| ${tableCellSource(cell)} |`).length !== 1) throw new Error("Ô bảng có dấu | chưa được bảo vệ. Dùng \\| để ghi ký tự | trong ô.");
          }
        }
        saving = true; ownsSave = true; body.inert = true; dialog.setAttribute("aria-busy", "true"); button.disabled = true; status("Đang lưu dữ liệu…");
        await onSave?.({ title: $("[data-title]").value.trim(), source: value() }); finish(); return;
      }
      const section = button.closest("[data-block]"); if (!section) return;
      const index = Number(section.dataset.block), block = blocks[index];
      // Merge/split take their own undo snapshot so exactly one step is pushed.
      if (block.type === "table" && (button.hasAttribute("data-merge") || button.hasAttribute("data-split"))) {
        tableCommand(index, button.hasAttribute("data-merge")); return;
      }
      // Row/column buttons share their single undo snapshot with the Alt+H / Alt+C
      // shortcuts, so they dispatch before the generic snapshot below.
      const resize = Object.keys(TABLE_RESIZE_ACTIONS).find((name) => button.hasAttribute(name));
      if (block.type === "table" && resize) { tableResize(index, TABLE_RESIZE_ACTIONS[resize]); return; }
      remember(crypto.randomUUID());
      if (button.hasAttribute("data-convert")) {
        block.simpleInput = section.querySelector("[data-simple]").value;
        await convertFormula(block, index, block.simpleInput); return;
      }
      if (button.dataset.insert) {
        const builder = section.querySelector("[data-template-builder]"), type = button.dataset.insert;
        const labels = { fraction: ["Tử số", "Mẫu số"], sqrt: ["Biểu thức trong căn"], power: ["Cơ số", "Số mũ"], subscript: ["Ký hiệu", "Chỉ số dưới"] }[type];
        builder.innerHTML = `${labels.map((label, i) => `<label>${label}<input data-argument="${i}" aria-label="${label}" placeholder="${i ? "b" : "a"}"></label>`).join("")}<button type="button" data-apply-template="${type}">Chèn mẫu</button>`;
        builder.hidden = false; builder.querySelector("input").focus(); return;
      }
      if (button.dataset.applyTemplate) {
        status("Đang dựng mẫu công thức…");
        const args = await Promise.all([...section.querySelectorAll("[data-argument]")].map((input) => formulaFromInput(input.value)));
        if (blocks[index] !== block || !section.isConnected) return;
        const templates = { fraction: `\\frac{${args[0]}}{${args[1]}}`, sqrt: `\\sqrt{${args[0]}}`, power: `{${args[0]}}^{${args[1]}}`, subscript: `{${args[0]}}_{${args[1]}}` };
        const input = section.querySelector("[data-latex]"), hasSelection = input.dataset.cursor === "true";
        input.setRangeText(templates[button.dataset.applyTemplate], hasSelection ? input.selectionStart : input.value.length, hasSelection ? input.selectionEnd : input.value.length, "select"); block.latex = input.value; block.dirty = true;
        block.simpleInput = ""; block.simpleError = ""; section.querySelector("[data-simple]").value = "";
        section.querySelector("[data-template-builder]").hidden = true; updatePreview(index); status("Đã chèn mẫu công thức · chưa lưu"); return;
      }
      if (button.hasAttribute("data-remove")) { blocks.splice(index, 1); draw(); status("Đã xóa khối khỏi bản nháp. Có thể Hoàn tác."); return; }
    } catch (error) { status(error.message || String(error), true); }
    finally { if (ownsSave) { saving = false; body.inert = false; dialog.removeAttribute("aria-busy"); if ($("[data-save]")) $("[data-save]").disabled = false; } }
  });
  dialog.addEventListener("focusin", (event) => {
    if (event.target.matches("[data-text],[data-latex],[data-cell],[data-source-input],[data-simple]")) activeInput = event.target;
    if (event.target.matches("[data-latex]")) event.target.dataset.cursor = "true";
  });
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    // Covered cells have no textarea, so the DOM order already skips them.
    if (event.key === "Tab" && event.target.matches?.("[data-cell]") && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const cells = [...event.target.closest("[data-block]").querySelectorAll("[data-cell]")];
      const next = cells[cells.indexOf(event.target) + (event.shiftKey ? -1 : 1)];
      if (next) { event.preventDefault(); next.focus(); return; } // Past the ends, native tabbing leaves the grid.
    }
    if (event.key === "Escape") {
      // A painted range is dismissed first; otherwise Escape keeps closing the dialog.
      if (cellSelection?.range) { event.preventDefault(); cellSelection = null; cellAnchor = null; paintSelection(); return; }
      event.preventDefault(); close();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); $("[data-save]")?.click(); }
    // Ctrl/Cmd+G and Ctrl/Cmd+T mirror the ⧉/⧈ buttons. Anywhere else — formula,
    // Markdown source, title — the key is left untouched for the webview.
    if ((event.ctrlKey || event.metaKey) && editable && !saving) {
      const key = event.key.toLowerCase();
      if (key === "g" || key === "t") {
        const index = Number(event.target.closest?.("[data-block]")?.dataset.block);
        if (blocks[index]?.type === "table") {
          event.preventDefault();
          try { tableCommand(index, key === "g"); } catch (error) { status(error.message || String(error), true); }
        }
      }
    }
    // Alt+H and Alt+C mirror ＋ Hàng and ＋ Cột. Outside a table block — formula,
    // Markdown source, title — the key is left untouched for the webview.
    if (event.altKey && !event.ctrlKey && !event.metaKey && editable && !saving) {
      const key = event.key.toLowerCase();
      if (key === "h" || key === "c") {
        const index = Number(event.target.closest?.("[data-block]")?.dataset.block);
        if (blocks[index]?.type === "table") {
          event.preventDefault();
          try { tableResize(index, key === "h" ? "row" : "column"); } catch (error) { status(error.message || String(error), true); }
        }
      }
    }
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  draw(); dialog.showModal(); $("[data-close]").focus();
  return { close, element: dialog, getValue: value };
}
