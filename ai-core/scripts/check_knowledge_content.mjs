import test from "node:test";
import assert from "node:assert/strict";
import { parseKnowledge, serializeKnowledge, renderKnowledge, renderTableCell, renderFormula, tableCells, formulaFromInput, parseTablePaste, fractionFromShorthand, tableRegions, normalizeTableRows, mergeTableRange, splitTableRange, splitTableAnchor, escapeMergeMarker } from "../src/knowledge-content.js";

const sample = String.raw`Khi $x\ne 0$:

$$y=\frac{a}{b}\sqrt{x^2+1}$$

| Tên | Giá trị | Đơn vị |
| --- | ---: | --- |
| Chiều dài | 12 | m |
| Diện tích | $S=a*b$ | $m^2$ |

Ghi chú nguồn.`;

test("Display formulas and real table without changing a single source byte", () => {
  assert.equal(serializeKnowledge(parseKnowledge(sample)), sample);
  const html = renderKnowledge(sample);
  assert.match(html, /class="katex"/);
  assert.match(html, /<table>/);
  assert.equal((html.match(/<th /g) || []).length, 3);
  assert.equal((html.match(/<td /g) || []).length, 6);
});
test("CRLF, blank lines, unsupported/malformed syntax, code stay intact", () => {
  for (const source of ["", "\r\n", sample.replaceAll("\n", "\r\n"), "  # title\n\ntext  ", "$$\\bad{oops\n| x | y |\n| --- | --- |\n| 1 | 2 |", "```js\n<script>alert(1)</script>\n```\n", "a \\(x+1\\) end"]) {
    assert.equal(serializeKnowledge(parseKnowledge(source)), source);
  }
});
test("Pipes inside math/code and escaped pipes never split cells", () => {
  assert.deepEqual(tableCells(String.raw`| $|x|$ | \(a|b\) | a\|b | \frac{a}{b} |`), ["$|x|$", String.raw`\(a|b\)`, String.raw`a\|b`, String.raw`\frac{a}{b}`]);
  assert.deepEqual(tableCells("| `x|y` | end |"), ["`x|y`", "end"]);
  assert.deepEqual(tableCells("| A | $50 | USD |"), ["A", "$50", "USD"]);
  assert.deepEqual(tableCells("| $$|x|$$ | end |"), ["$$|x|$$", "end"]);
});
test("Excel paste supports quoted multiline cells without splitting their rows", () => {
  assert.deepEqual(parseTablePaste('Tên\tGiá trị\r\n"A"\t3\r\n'), [["Tên", "Giá trị"], ["A", "3"]]);
  assert.deepEqual(parseTablePaste('"A ""B"""\t4'), [['A "B"', "4"]]);
  assert.deepEqual(parseTablePaste('"a\nb"\t3'), [["a\nb", "3"]]);
  assert.deepEqual(parseTablePaste('"a\tb"\t3'), [["a\tb", "3"]]);
  assert.throws(() => parseTablePaste('"unclosed\nfield'), /chưa đóng/);
});
test("A slash in a table cell is a plain character, never an automatic fraction", () => {
  const source = "| A | B |\n| --- | --- |\n| 5/4 | 10w/57kt |\n";
  const table = parseKnowledge(source)[0];
  assert.deepEqual(table.rows[1], ["5/4", "10w/57kt"]); // No rewrite in either direction.
  assert.equal(serializeKnowledge(parseKnowledge(source)), source);
  assert.equal(serializeKnowledge([{ ...table, dirty: true }]), source); // A rebuild writes the same bytes.
  const html = renderKnowledge(source);
  assert.match(html, /<td style="text-align:left">5\/4<\/td>/);
  assert.match(html, /<td style="text-align:left">10w\/57kt<\/td>/);
  assert.ok(!html.includes("mfrac")); // A typed ratio stays text in the document view.
  // Editing another cell must not turn the literal slashes into LaTeX.
  const blocks = parseKnowledge(source), edited = blocks.find((b) => b.type === "table");
  edited.rows[0][0] = "X"; edited.dirty = true;
  assert.ok(serializeKnowledge(blocks).includes("| 5/4 | 10w/57kt |"));
  // Only inserted math stacks; the cell renderer still renders explicit $...$ as today.
  assert.equal(renderTableCell("10w/57kt"), "10w/57kt");
  assert.equal(renderTableCell("5/4"), "5/4");
  assert.match(renderTableCell(String.raw`$\frac{a}{b}$`), /class="katex"[\s\S]*mfrac/);
});

test("Stored LaTeX in a cell round-trips byte-identically and keeps rendering", () => {
  const stored = String.raw`| Tên | Giá trị |
| --- | --- |
| Tỷ số | $\frac{10W87}{570KT}$ |
`;
  const table = parseKnowledge(stored).find((b) => b.type === "table");
  assert.equal(table.rows[1][1], String.raw`$\frac{10W87}{570KT}$`); // Kept verbatim, never re-shortened.
  assert.equal(serializeKnowledge(parseKnowledge(stored)), stored);
  assert.equal(serializeKnowledge([{ ...table, dirty: true }]), stored); // A rebuild writes the same bytes.
  assert.match(renderKnowledge(stored), /<span class="knowledge-inline-math">[\s\S]*mfrac/);
  // Editing a neighbouring cell keeps the stored LaTeX byte-identical too.
  const blocks = parseKnowledge(stored), edited = blocks.find((b) => b.type === "table");
  edited.rows[0][0] = "Đại lượng"; edited.dirty = true;
  assert.ok(serializeKnowledge(blocks).includes(String.raw`| Tỷ số | $\frac{10W87}{570KT}$ |`));
});

test("Multiline cells survive save/reopen without breaking table structure", () => {
  const blocks = parseKnowledge(sample), table = blocks.find((b) => b.type === "table");
  table.rows[1][1] = "Dòng một\n10w/57kt\nDòng ba"; table.dirty = true;
  const source = serializeKnowledge(blocks);
  assert.ok(source.includes("Dòng một<br>10w/57kt<br>Dòng ba"));
  assert.ok(!/\$\\frac\{10w\}/.test(source)); // No fraction is invented from the typed slash.
  const restored = parseKnowledge(source).find((b) => b.type === "table");
  assert.equal(restored.rows[1][1], table.rows[1][1]);
  assert.equal(restored.rows.length, 3);
  assert.ok(restored.rows.every((row) => row.length === 3));
  assert.match(renderKnowledge(source), /<td style="text-align:right">Dòng một<br>10w\/57kt<br>Dòng ba<\/td>/);
  assert.equal(serializeKnowledge(parseKnowledge(source)), source);
});
test("Only attribute-free table breaks are decoded; code and HTML remain inert", () => {
  const source = '| A | B |\n| --- | --- |\n| a<br />b<BR>c | `<br>` <br onclick="x()"> |';
  const table = parseKnowledge(source)[0];
  assert.equal(table.rows[1][0], "a\nb\nc");
  assert.equal(table.rows[1][1], '`<br>` <br onclick="x()">');
  const html = renderKnowledge(source);
  assert.ok(html.includes('<code>&lt;br&gt;</code>'));
  assert.ok(!html.includes('<br onclick'));
});
test("Edit one table cell, preserve formula, surrounding text and alignment", () => {
  const blocks = parseKnowledge(sample), table = blocks.find((b) => b.type === "table");
  table.rows[1][1] = "18"; table.dirty = true;
  const output = serializeKnowledge(blocks);
  assert.match(output, /\| Chiều dài \| 18 \| m \|/);
  assert.match(output, /\| --- \| ---: \| --- \|/);
  assert.ok(output.includes(String.raw`$$y=\frac{a}{b}\sqrt{x^2+1}$$`));
  assert.match(output, /Ghi chú nguồn\.$/);
});
test("Math entry converts notation only, no eval/assignment or arbitrary functions", async () => {
  assert.match(await formulaFromInput("s=v*t"), /s.* = .*v.*t/);
  assert.match(await formulaFromInput("(a+b)/c"), /\\frac/);
  assert.match(await formulaFromInput("sqrt(x^2+1)"), /\\sqrt/);
  assert.equal(await formulaFromInput("10w/57kt"), String.raw`\frac{10w}{57kt}`);
  assert.equal(await formulaFromInput("1/2x"), String.raw`\frac{1}{2x}`);
  // The formula block keeps its shorthand; only table cells stopped converting.
  assert.match(renderFormula("10w/57kt"), /mfrac/);
  assert.match(renderKnowledge("$$10w/57kt$$"), /mfrac/);
  for (const source of ["https://example.com", "17/09/2026", "Ghi chú 10w/57kt", "a/b/c"]) assert.equal(fractionFromShorthand(source), null);
  for (const input of ["import('x')", "a.b", "[1,2]", "x; y", "", "f(x)=x+1"]) await assert.rejects(() => formulaFromInput(input));
});
test("Untrusted HTML and LaTeX cannot inject active elements", () => {
  const html = renderKnowledge('<img src=x onerror=alert(1)>\n\n| X | Y |\n| --- | --- |\n| <script>x</script> | & |');
  assert.ok(!/<img|<script/i.test(html));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!/<a\s[^>]*href/i.test(renderFormula(String.raw`\href{javascript:alert(1)}{click}`)));
  assert.match(renderFormula(String.raw`\frac{1`), /knowledge-math-error/);
});

// Covered cells are stored as whole-cell markers, so the document stays a single
// Markdown pipe table: merging lives in the source, never in HTML attributes.
const tableBlock = (rows, align = ["left", "left", "left"]) => ({ type: "table", rows, align, raw: "", text: "", dirty: true });
const grid = [["H1", "H2", "H3"], ["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]];

test("A merged region round-trips through save and reopen as one pipe table", () => {
  const merged = mergeTableRange(grid, { top: 1, left: 1, bottom: 2, right: 2 });
  assert.deepEqual(merged, [["H1", "H2", "H3"], ["a", "b\nc\ne\nf", "<<"], ["d", "^^", "<<"], ["g", "h", "i"]]);
  const source = serializeKnowledge([tableBlock(merged)]);
  assert.ok(source.includes("| << |"));
  assert.ok(source.includes("| ^^ | << |"));
  assert.ok(!/<table|colspan|rowspan/i.test(source)); // Never HTML in a stored document.
  const restored = parseKnowledge(source).find((b) => b.type === "table");
  assert.deepEqual(restored.rows, merged);
  assert.ok(restored.rows.every((row) => row.length === 3));
  assert.equal(serializeKnowledge([{ ...restored, raw: "", text: "", dirty: true }]), source);
});

test("Merged cells render as real colspan/rowspan and covered cells disappear", () => {
  const source = serializeKnowledge([tableBlock(mergeTableRange(grid, { top: 1, left: 1, bottom: 2, right: 2 }))]);
  const html = renderKnowledge(source);
  assert.match(html, /<td colspan="2" rowspan="2" style="text-align:left">b<br>c<br>e<br>f<\/td>/);
  assert.equal((html.match(/<td /g) || []).length, 6); // 9 logical body cells minus 3 covered.
  assert.equal((html.match(/<th /g) || []).length, 3);
  assert.ok(!html.includes("&lt;&lt;") && !html.includes("^^"));
  const headerSpan = mergeTableRange([["A", "B"], ["c", "d"]], { top: 0, left: 0, bottom: 0, right: 1 });
  assert.match(renderKnowledge(serializeKnowledge([tableBlock(headerSpan)])), /<th scope="col" colspan="2" style="text-align:left">A<br>B<\/th>/);
  const rowSpan = mergeTableRange([["A", "B"], ["c", "d"], ["e", "f"]], { top: 1, left: 0, bottom: 2, right: 0 });
  assert.match(renderKnowledge(serializeKnowledge([tableBlock(rowSpan)])), /<td rowspan="2" style="text-align:left">c<br>e<\/td>/);
});

test("Escape whole-cell markers by hand; literal text must never become a merge", () => {
  const source = String.raw`| A | B |
| --- | --- |
| \<< | \^^ |`;
  const table = parseKnowledge(source).find((b) => b.type === "table");
  assert.deepEqual(table.rows, [["A", "B"], ["\\<<", "\\^^"]]);
  assert.equal(tableRegions(table.rows).regions.length, 0);
  const html = renderKnowledge(source);
  assert.ok(!/colspan|rowspan/.test(html));
  assert.ok(html.includes("&lt;&lt;")); // The literal characters still read as text.
  assert.ok(html.includes("^^"));
  const reSaved = serializeKnowledge([{ ...table, raw: "", text: "", dirty: true }]);
  assert.ok(reSaved.includes(String.raw`| \<< | \^^ |`));
  assert.equal(tableRegions(parseKnowledge(reSaved)[0].rows).regions.length, 0);
});

test("Merged cells cannot smuggle active markup into the rendered table", () => {
  const source = [
    "| <img src=x onerror=alert(1)> | B |",
    "| --- | --- |",
    "| <script>x</script> | << |",
  ].join("\n");
  const html = renderKnowledge(source);
  assert.match(html, /<td colspan="2" style="text-align:left">&lt;script&gt;x&lt;\/script&gt;<\/td>/);
  assert.ok(!/<img|<script/i.test(html));
  assert.ok(!/<[^>]*onerror/i.test(html)); // Escaped text may contain the word; no tag may carry it.
});

test("Unresolvable markers degrade to empty cells without throwing or dropping content", () => {
  const malformed = [
    String.raw`| A | B |
| --- | --- |
| << | x |`,
    String.raw`| A | ^^ |
| --- | --- |
| x | y |`,
    String.raw`| h1 | << | << |
| --- | --- | --- |
| x | ^^ | y |`, // Header span plus one hanging marker is not a rectangle.
  ];
  for (const source of malformed) {
    const table = parseKnowledge(source).find((b) => b.type === "table");
    assert.equal(normalizeTableRows(table.rows), table.rows); // Parsing already repaired it.
    assert.equal(tableRegions(table.rows).regions.length, 0);
    const html = renderKnowledge(source);
    assert.ok(!/colspan|rowspan/.test(html));
    for (const kept of table.rows.flat()) assert.ok(!kept.includes("<<") && !kept.includes("^^"));
  }
  assert.deepEqual(parseKnowledge(malformed[0])[0].rows, [["A", "B"], ["", "x"]]);
  assert.deepEqual(parseKnowledge(malformed[1])[0].rows, [["A", ""], ["x", "y"]]);
  assert.deepEqual(parseKnowledge(malformed[2])[0].rows, [["h1", "", ""], ["x", "", "y"]]);
});

test("Splitting dissolves only the selected regions and repairs orphaned markers", () => {
  const merged = mergeTableRange(grid, { top: 1, left: 1, bottom: 2, right: 2 });
  assert.deepEqual(splitTableRange(merged, { top: 2, left: 2, bottom: 2, right: 2 }), [["H1", "H2", "H3"], ["a", "b\nc\ne\nf", ""], ["d", "", ""], ["g", "h", "i"]]);
  assert.equal(splitTableRange(merged, { top: 0, left: 0, bottom: 0, right: 0 }), null);
  assert.equal(tableRegions(splitTableRange(merged, { top: 1, left: 1, bottom: 1, right: 1 })).regions.length, 0);
  // A stray marker that strands a span into a non-rectangular region is repaired.
  assert.deepEqual(normalizeTableRows([["A", "B"], ["^^", "<<"]]), [["A", "B"], ["", ""]]);
});

test("⧈ Tách ô accepts the single clicked cell instead of a dragged range", () => {
  const merged = mergeTableRange(grid, { top: 1, left: 1, bottom: 2, right: 2 });
  assert.deepEqual(splitTableAnchor(merged, { r: 1, c: 1 }), [["H1", "H2", "H3"], ["a", "b\nc\ne\nf", ""], ["d", "", ""], ["g", "h", "i"]]);
  // A covered cell addresses the same region, so any click inside it works.
  assert.equal(tableRegions(splitTableAnchor(merged, { r: 2, c: 2 })).regions.length, 0);
  assert.equal(splitTableAnchor(grid, { r: 0, c: 0 }), null); // Nothing merged under the clicked cell.
  // One anchor dissolves only its own region; a merge elsewhere in the table stays.
  const vertical = mergeTableRange(grid, { top: 1, left: 0, bottom: 2, right: 0 });
  const twoRegions = mergeTableRange(vertical, { top: 1, left: 2, bottom: 2, right: 2 });
  assert.equal(tableRegions(twoRegions).regions.length, 2);
  const left = splitTableAnchor(twoRegions, { r: 2, c: 0 });
  assert.deepEqual(tableRegions(left).regions, [{ top: 1, left: 2, rowSpan: 2, colSpan: 1 }]);
  assert.deepEqual(left[1], ["a\nd", "b", "c\nf"]);
  assert.deepEqual(left[2], ["", "e", "^^"]);
});

test("A bare marker typed into a cell stays text and never dissolves a merge", () => {
  assert.equal(escapeMergeMarker("<<"), String.raw`\<<`);
  assert.equal(escapeMergeMarker("^^"), String.raw`\^^`);
  assert.equal(escapeMergeMarker(" << "), String.raw`\<<`); // Only a whole-cell marker is escaped.
  assert.equal(escapeMergeMarker("<<x"), "<<x");
  assert.equal(escapeMergeMarker(String.raw`\<<`), String.raw`\<<`); // Escaping is idempotent.
  const header = mergeTableRange([["A", "B", "C"], ["d", "e", "f"], ["g", "h", "i"], ["j", "k", "l"]], { top: 0, left: 0, bottom: 0, right: 1 });
  const both = mergeTableRange(header, { top: 1, left: 0, bottom: 2, right: 0 });
  assert.equal(tableRegions(both).regions.length, 2);
  // The defect: the raw marker strands the column span into a non-rectangle, so the
  // next render/serialize quietly dissolves it and writes escaped literals instead.
  const raw = both.map((row) => [...row]); raw[1][1] = "<<";
  assert.equal(tableRegions(raw).regions.length, 1);
  const dissolved = serializeKnowledge([tableBlock(raw)]);
  assert.ok(dissolved.includes(String.raw`| \<< |`) && dissolved.includes(String.raw`| \^^ |`));
  // The fix: the committed value is stored escaped, so both merges survive.
  const text = both.map((row) => [...row]); text[1][1] = escapeMergeMarker("<<");
  assert.equal(tableRegions(text).regions.length, 2);
  const source = serializeKnowledge([tableBlock(text)]);
  assert.ok(source.includes(String.raw`| \<< |`) && source.includes("| ^^ |"));
  assert.ok(!/<[^>]*rowspan/i.test(source)); // Still one Markdown pipe table, never HTML.
  const restored = parseKnowledge(source).find((b) => b.type === "table");
  assert.deepEqual(restored.rows, text);
  assert.ok(restored.rows.every((row) => row.length === 3));
  assert.equal(serializeKnowledge([{ ...restored, raw: "", text: "", dirty: true }]), source);
  const html = renderKnowledge(source);
  assert.match(html, /<td rowspan="2"/);
  assert.ok(html.includes("&lt;&lt;")); // The two typed characters still read as text.
});
