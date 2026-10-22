import test from "node:test";
import assert from "node:assert/strict";
import { prepareChatTables } from "../src/chat-tables.js";

const table = String.raw`| STT | Tên | Khối lượng | Tỉ lệ | Khoảng cách | Phương pháp | Thiết bị | Vị trí |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| 1 | Mẫu A <br>Mã A1 | 87,75 | $\frac{10}{57}$ | 9.600 | **Tự động** | | Trong nhà |
| 2 | Mẫu B | 34,46 | $|x|$ | 13.000 | \(a|b\) | Động cơ | Ngoài trời |`;

test("chat tables become a real eight-column grid with math and multiline cells", () => {
  const blocks = [];
  const text = prepareChatTables(`Thông tin:\n${table}\nNguồn: [R1]`, blocks);
  assert.equal(text, "Thông tin:\n\n\n@@B0@@\n\nNguồn: [R1]");
  assert.equal(blocks.length, 1);
  const html = blocks[0];
  assert.match(html, /chat-table-scroll/);
  assert.match(html, /tabindex="0" role="region"/);
  assert.equal((html.match(/<th /g) || []).length, 8);
  assert.equal((html.match(/<td /g) || []).length, 16);
  assert.match(html, /Mẫu A <br>Mã A1/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<strong>Tự động<\/strong>/);
  assert.match(html, /<td style="text-align:left"><\/td>/);
  assert.ok(!html.includes("&lt;br&gt;"));
});

test("plain prose, code fences, and incomplete table headers retain their original text", () => {
  for (const source of ["a | b", "| A | B |\n| --", `\`\`\`markdown\n${table}\n\`\`\``]) {
    const blocks = [];
    const text = prepareChatTables(source, blocks);
    assert.equal(blocks.length, 0);
    assert.equal(text, source.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
  }
});

test("table HTML stays inert except attribute-free line breaks", () => {
  const blocks = [];
  prepareChatTables('| A | B |\n| --- | --- |\n| <img src=x onerror=alert(1)> | <br onmouseover=alert(1)> |', blocks);
  assert.ok(!/<img|<br onmouseover/.test(blocks[0]));
  assert.match(blocks[0], /&lt;img/);
  assert.match(blocks[0], /&lt;br onmouseover/);
});

test("multiple tables get independent placeholders and streamed rows render progressively", () => {
  const blocks = ["previous block"];
  const text = prepareChatTables(`${table}\n\nGhi chú\n\n${table}`, blocks);
  assert.match(text, /@@B1@@/);
  assert.match(text, /@@B2@@/);
  for (const source of ['| A | B |\n| --- | --- |', '| A | B |\n| --- | --- |\n| Một']) {
    const partial = [];
    prepareChatTables(source, partial);
    assert.match(partial[0], /<table>/);
    assert.equal((partial[0].match(/<th /g) || []).length, 2);
  }
});
