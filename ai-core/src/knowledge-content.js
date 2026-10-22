import katex from "katex";

// Display/editing only: never evaluate document text or change verification state.
export const escapeContent = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const escaped = (text, at) => { let n = 0; while (at > 0 && text[--at] === "\\") n++; return n % 2 === 1; };

// A whole-line ratio is unambiguous in a formula field. Do not rewrite prose,
// URLs, dates with two slashes, or existing LaTeX commands. Table cells never go
// through this: a slash typed in a cell stays a plain character, and a real
// fraction only ever arrives by inserting one from the symbol library.
export function fractionFromShorthand(input) {
  const sides = String(input).trim().split("/");
  const term = /^[+-]?(?:\d+(?:\.\d+)?(?:\s*[A-Za-zα-ωΑ-Ω][A-Za-z0-9α-ωΑ-Ω]*)?|[A-Za-zα-ωΑ-Ω][A-Za-z0-9α-ωΑ-Ω]*)(?:\^[+-]?\d+)?$/u;
  if (sides.length !== 2 || sides.some((side) => !side.trim() || !/[\dA-Za-zα-ωΑ-Ω]/u.test(side) || !term.test(side.trim()))) return null;
  return `\\frac{${sides[0].trim()}}{${sides[1].trim()}}`;
}

// A merged region lives inside the same Markdown pipe table: every covered cell
// holds a marker pointing at the neighbour it merges into, so no HTML table is
// ever stored or parsed. A cell that must *show* those characters escapes them
// with a leading backslash, exactly like a literal | inside a cell.
const MERGE_LEFT = "<<", MERGE_UP = "^^";
const mergeMarker = (cell) => {
  const text = String(cell ?? "").trim();
  return text === MERGE_LEFT || text === MERGE_UP ? text : null;
};
export const escapeMergeMarker = (cell) => {
  const value = String(cell ?? "");
  return mergeMarker(value) ? `\\${value.trim()}` : value;
};

export function tableCellSource(cell, covered = false) {
  // Covered cells must keep their bare marker; any other cell holding the same
  // characters is real text and is escaped so it never turns into a merge.
  // The source is written exactly as typed: `/` is an ordinary character, so a
  // cell never gains a $\frac{}{}$ the user did not insert.
  const value = covered ? String(cell ?? "") : escapeMergeMarker(cell);
  return value.replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}

// Inline math and code spans keep their markup verbatim; only attribute-free
// <br> becomes a real newline. Existing stored LaTeX in a cell is therefore
// neither rewritten nor re-interpreted as shorthand.
const editableTableCell = (cell) => cell.replace(/(`[^`]*`|\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|<br\s*\/?>)/gi, (token) => /^<br/i.test(token) ? "\n" : token);

export function tableCells(line) {
  const text = line.trim();
  if (!text.startsWith("|")) return null;
  const cells = []; let value = "", math = null, code = false;
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (c === "`" && !math && !escaped(text, i)) code = !code;
    if (!code) {
      if (c === "$" && !escaped(text, i)) {
        const delimiter = math === "$" || math === "$$" ? math : text.startsWith("$$", i) ? "$$" : "$";
        if (math === delimiter && text.startsWith(delimiter, i)) { math = null; value += delimiter; i += delimiter.length - 1; continue; }
        if (!math) {
          let end = text.indexOf(delimiter, i + delimiter.length);
          while (end >= 0 && escaped(text, end)) end = text.indexOf(delimiter, end + delimiter.length);
          if (end >= 0) { math = delimiter; value += delimiter; i += delimiter.length - 1; continue; }
        }
      }
      if (text.slice(i, i + 2) === "\\(" && !math) math = "paren";
      if (text.slice(i, i + 2) === "\\)" && math === "paren") math = null;
    }
    if (c === "|" && !code && !math && !escaped(text, i)) { cells.push(value.trim()); value = ""; }
    else value += c;
  }
  if (value || !text.endsWith("|") || escaped(text, text.length - 1)) cells.push(value.trim());
  return cells;
}

// Reconstruct merged regions row-major with union-find over the stored grid.
// Only a full rectangle is a region: anything else is reported as invalid and
// callers degrade it to an empty cell instead of throwing or emitting bad HTML.
export function tableRegions(rows) {
  const grid = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? row : []));
  const height = grid.length, width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const key = (r, c) => `${r}:${c}`;
  const parent = new Map();
  const ensure = (node) => { if (!parent.has(node)) parent.set(node, node); return node; };
  const find = (node) => { let root = node; while (parent.get(root) !== root) root = parent.get(root); return root; };
  const markers = new Set(), invalid = new Set();
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const marker = mergeMarker(grid[r]?.[c]);
    if (!marker) continue;
    const node = ensure(key(r, c)); markers.add(node);
    const target = marker === MERGE_LEFT ? (c > 0 ? key(r, c - 1) : "") : (r > 0 ? key(r - 1, c) : "");
    if (!target) { invalid.add(node); continue; }
    const root = find(node), other = find(ensure(target));
    if (root !== other) parent.set(root, other);
  }
  const components = new Map();
  for (const node of parent.keys()) { const root = find(node); components.set(root, [...(components.get(root) || []), node]); }
  const regions = [], covered = new Set();
  for (const members of components.values()) {
    const coords = members.map((node) => node.split(":").map(Number));
    const top = Math.min(...coords.map(([r]) => r)), bottom = Math.max(...coords.map(([r]) => r));
    const left = Math.min(...coords.map(([, c]) => c)), right = Math.max(...coords.map(([, c]) => c));
    const coveredNodes = members.filter((node) => markers.has(node));
    if (members.length !== (bottom - top + 1) * (right - left + 1)) { coveredNodes.forEach((node) => invalid.add(node)); continue; }
    regions.push({ top, left, rowSpan: bottom - top + 1, colSpan: right - left + 1 });
    coveredNodes.forEach((node) => covered.add(node));
  }
  regions.sort((a, b) => a.top - b.top || a.left - b.left);
  return { width, height, regions, covered, invalid };
}

// A marker that can no longer resolve (first row/column, or a region that is not
// a rectangle) becomes an empty cell: covered cells never held their own text,
// so no real content is dropped by the repair.
export function normalizeTableRows(rows) {
  const grid = Array.isArray(rows) ? rows : [];
  const { invalid } = tableRegions(grid);
  if (!invalid.size) return grid;
  return grid.map((row, r) => (Array.isArray(row) ? row.map((cell, c) => invalid.has(`${r}:${c}`) ? "" : cell) : row));
}

const setCell = (grid, r, c, value) => {
  const row = (grid[r] ||= []);
  while (row.length < c) row.push("");
  row[c] = value;
};

// The selection's top-left cell keeps the combined content; every other cell of
// the rectangle becomes the marker that reconstructs it.
export function mergeTableRange(rows, { top, left, bottom, right }) {
  const grid = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? [...row] : []));
  const { covered, invalid } = tableRegions(grid), values = [];
  for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) {
    if (covered.has(`${r}:${c}`) || invalid.has(`${r}:${c}`)) continue; // Markers are not content.
    const value = String(grid[r]?.[c] ?? "");
    if (value.trim()) values.push(value);
  }
  for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) {
    setCell(grid, r, c, r === top && c === left ? values.join("\n") : (c > left ? MERGE_LEFT : MERGE_UP));
  }
  return normalizeTableRows(grid);
}

// Every region intersecting the selection is dissolved; regions elsewhere in the
// table are left merged. Returns null when the selection holds no merged cell.
export function splitTableRange(rows, { top, left, bottom, right }) {
  const grid = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? [...row] : []));
  const { regions } = tableRegions(grid);
  const targets = regions.filter((region) => region.top <= bottom && region.left <= right && top <= region.top + region.rowSpan - 1 && left <= region.left + region.colSpan - 1);
  if (!targets.length) return null;
  for (const region of targets) for (let r = region.top; r < region.top + region.rowSpan; r++) for (let c = region.left; c < region.left + region.colSpan; c++) {
    if (r !== region.top || c !== region.left) setCell(grid, r, c, "");
  }
  return normalizeTableRows(grid);
}

// A single clicked cell is the same 1×1 selection, so ⧈ Tách ô works without a
// dragged range. Returns null when that cell lies in no merged region.
export function splitTableAnchor(rows, { r, c }) {
  return splitTableRange(rows, { top: r, left: c, bottom: r, right: c });
}

const divider = (line) => { const cells = tableCells(line); return cells?.length && cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, ""))); };
const formulaBlock = (text) => {
  const match = text.trim().match(/^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])$/);
  return match ? (match[1] ?? match[2]).trim() : null;
};

export function parseKnowledge(source) {
  const lines = String(source ?? "").match(/[^\n]*\n|[^\n]+$/g) || [];
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const start = i, line = lines[i].trim(); let block;
    if (!line) { while (i < lines.length && !lines[i].trim()) i++; block = { type: "space" }; }
    else if (/^```/.test(line)) {
      i++; while (i < lines.length && !/^```/.test(lines[i].trim())) i++;
      if (i < lines.length) i++;
      block = { type: "code" };
    } else if (line.startsWith("$$") || line.startsWith("\\[")) {
      const close = line.startsWith("$$") ? "$$" : "\\]";
      i++;
      let closed = line.slice(2).includes(close);
      while (i < lines.length && !closed) closed = lines[i++].includes(close);
      const latex = formulaBlock(lines.slice(start, i).join(""));
      block = latex === null ? { type: "text" } : { type: "formula", latex };
    } else if (tableCells(line) && divider(lines[i + 1] || "")) {
      const header = tableCells(line), align = tableCells(lines[i + 1]).map((c) => c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left");
      i += 2; const rows = [header];
      while (i < lines.length && tableCells(lines[i].trim()) && !divider(lines[i])) rows.push(tableCells(lines[i++]));
      block = { type: "table", rows: normalizeTableRows(rows.map((row) => row.map(editableTableCell))), align };
    } else {
      i++;
      while (i < lines.length && lines[i].trim() && !/^(?:\$\$|\\\[|```)/.test(lines[i].trim()) && !(tableCells(lines[i]) && divider(lines[i + 1] || ""))) i++;
      block = { type: "text" };
    }
    const raw = lines.slice(start, i).join("");
    blocks.push({ ...block, raw, text: raw.trimEnd(), dirty: false });
  }
  return blocks;
}

export function parseTablePaste(source) {
  const text = source.replace(/\r\n?/g, "\n"), rows = [], row = [];
  let cell = "", quoted = false, endedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; endedQuote = true; }
      else cell += c;
    } else if (c === '"' && !cell && !endedQuote) quoted = true;
    else if (c === "\t" || c === "\n") {
      row.push(cell); cell = ""; endedQuote = false;
      if (c === "\n") { rows.push(row.splice(0)); }
    } else if (endedQuote) throw new Error("Vùng ô được dán có dấu ngoặc kép chưa hợp lệ. Chưa thay đổi bảng.");
    else cell += c;
  }
  if (quoted) throw new Error("Vùng ô được dán có dấu ngoặc kép chưa đóng. Chưa thay đổi bảng.");
  if (cell || row.length || endedQuote || !rows.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function serializeKnowledge(blocks) {
  return blocks.map((b) => {
    if (!b.dirty) return b.raw;
    let text = b.text || "";
    if (b.type === "formula") text = `$$\n${b.latex}\n$$`;
    if (b.type === "table") {
      const width = Math.max(...b.rows.map((r) => r.length));
      const { covered } = tableRegions(b.rows);
      const row = (cells, index) => `| ${Array.from({ length: width }, (_, i) => tableCellSource(cells[i], covered.has(`${index}:${i}`))).join(" | ")} |`;
      const separators = Array.from({ length: width }, (_, i) => b.align?.[i] === "right" ? "---:" : b.align?.[i] === "center" ? ":---:" : "---");
      text = [row(b.rows[0], 0), row(separators, -1), ...b.rows.slice(1).map((cells, i) => row(cells, i + 1))].join("\n");
    }
    return text + (b.raw?.match(/(?:\r?\n)+$/)?.[0] || "\n\n");
  }).join("");
}

export function renderFormula(latex, displayMode = true) {
  try {
    if (latex.length > 12000) throw new Error("Công thức quá dài để hiển thị an toàn.");
    return katex.renderToString(fractionFromShorthand(latex) || latex, { displayMode, throwOnError: true, trust: false, strict: "ignore", maxExpand: 300, maxSize: 20, output: "htmlAndMathml" });
  } catch {
    return `<span class="knowledge-math-error" title="Chỉ là lỗi hiển thị; nội dung nguồn được giữ nguyên.">Không hiển thị được công thức: <code>${escapeContent(latex)}</code></span>`;
  }
}

export function renderKnowledgeInline(source) {
  // Tokenize before escaping: markup is never applied inside KaTeX output.
  const pattern = /(`[^`\n]+`|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\*\*[^\n]+?\*\*)/g;
  let html = "", cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (escaped(source, match.index)) continue;
    html += escapeContent(source.slice(cursor, match.index)).replace(/\\\|/g, "|").replace(/\n/g, "<br>");
    const token = match[0];
    if (token.startsWith("`")) html += `<code>${escapeContent(token.slice(1, -1))}</code>`;
    else if (token.startsWith("**")) html += `<strong>${escapeContent(token.slice(2, -2))}</strong>`;
    else { const n = token.startsWith("$$") || token.startsWith("\\(") ? 2 : 1; html += `<span class="knowledge-inline-math">${renderFormula(token.slice(n, -n), false)}</span>`; }
    cursor = match.index + token.length;
  }
  return html + escapeContent(source.slice(cursor)).replace(/\\\|/g, "|").replace(/\n/g, "<br>");
}

export function renderKnowledge(source) {
  return parseKnowledge(source).map((b) => {
    if (b.type === "space") return "";
    if (b.type === "formula") return `<div class="knowledge-display-math">${renderFormula(b.latex)}</div>`;
    if (b.type === "code") return `<pre><code>${escapeContent(b.text)}</code></pre>`;
    if (b.type === "table") {
      const width = Math.max(...b.rows.map((row) => row.length));
      const { covered, invalid, regions } = tableRegions(b.rows);
      const anchor = new Map(regions.map((region) => [`${region.top}:${region.left}`, region]));
      const cells = (row, index, tag) => Array.from({ length: width }, (_, i) => {
        const key = `${index}:${i}`;
        if (covered.has(key)) return ""; // Covered cells belong to their region's anchor.
        const region = anchor.get(key);
        const span = region ? `${region.colSpan > 1 ? ` colspan="${region.colSpan}"` : ""}${region.rowSpan > 1 ? ` rowspan="${region.rowSpan}"` : ""}` : "";
        return `<${tag}${tag === "th" ? ' scope="col"' : ""}${span} style="text-align:${b.align[i] || "left"}">${renderTableCell(invalid.has(key) ? "" : row[i] || "")}</${tag}>`;
      }).join("");
      return `<div class="knowledge-table-scroll" tabindex="0" role="region" aria-label="Bảng dữ liệu, cuộn ngang để xem các cột"><table><thead><tr>${cells(b.rows[0], 0, "th")}</tr></thead><tbody>${b.rows.slice(1).map((row, index) => `<tr>${cells(row, index + 1, "td")}</tr>`).join("")}</tbody></table></div>`;
    }
    return b.text.split(/\r?\n/).map((line) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      return heading ? `<h${heading[1].length}>${renderKnowledgeInline(heading[2])}</h${heading[1].length}>` : `<p>${renderKnowledgeInline(line)}</p>`;
    }).join("");
  }).join("");
}

export function renderTableCell(cell) {
  // An escaped whole-cell marker is literal text, so it must read as such. A plain
  // `10w/57kt` is inert text too; explicit $...$ math renders through KaTeX.
  return String(cell ?? "").replace(/^\s*\\(<<|\^\^)\s*$/, "$1").split(/\r?\n/).map((line) => renderKnowledgeInline(line)).join("<br>");
}

let mathParser;
export async function formulaFromInput(input) {
  if (!input.trim() || input.length > 2000) throw new Error("Nhập biểu thức từ 1 đến 2.000 ký tự.");
  const fraction = fractionFromShorthand(input);
  if (fraction) return fraction;
  // Reading tables/formulas must not initialize the symbolic parser. Load it
  // only when the user explicitly converts plain mathematical notation.
  const { parse } = await (mathParser ||= import("mathjs"));
  const functions = new Set(["sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "log", "abs", "exp"]);
  return input.split("=").map((side) => {
    const node = parse(side.trim()); let count = 0;
    node.traverse((part) => {
      if (++count > 200 || !["ConstantNode", "SymbolNode", "OperatorNode", "ParenthesisNode", "FunctionNode"].includes(part.type)) throw new Error("Chỉ hỗ trợ biểu thức toán học; không nhận lệnh hoặc phép gán.");
      if (part.type === "FunctionNode" && !functions.has(part.fn.name)) throw new Error("Hàm chưa hỗ trợ. Dùng sqrt, sin, cos, tan, log, abs, exp hoặc chuyển sang LaTeX.");
      if (part.type === "ConstantNode" && typeof part.value !== "number") throw new Error("Hằng số phải là số.");
      if (part.type === "OperatorNode" && !["+", "-", "*", "/", "^", "%"].includes(part.op)) throw new Error("Toán tử chưa hỗ trợ.");
    });
    return node.toTex({ parenthesis: "auto", implicit: "hide" });
  }).join(" = ");
}
