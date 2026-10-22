import assert from "node:assert/strict";
import fs from "node:fs";
import { rankBuiltinChunks } from "../src/builtin-knowledge.js";

const payload = JSON.parse(fs.readFileSync(new URL("../public/knowledge/builtin-knowledge.json", import.meta.url), "utf8"));

assert.equal(payload.documents.length, 3, "Kho tích hợp phải có đúng ba tài liệu");
assert.equal(payload.documents.reduce((sum, item) => sum + item.math_objects, 0), 743, "Số công thức OMML đã thay đổi");
assert.equal(payload.documents.reduce((sum, item) => sum + item.tables, 0), 5, "Số bảng DOCX đã thay đổi");

const expectTopDocument = (question, documentId) => {
  const results = rankBuiltinChunks(payload, question);
  assert.ok(results.length, `Không truy xuất được nguồn cho: ${question}`);
  assert.equal(results[0].document_id, documentId, `Nguồn đứng đầu sai cho: ${question}`);
};

expectTopDocument("Kcn được tính như thế nào?", "so-tay");
expectTopDocument("Công thức ly giác trong tài liệu cao xạ là gì?", "si-quan-cao-xa");
expectTopDocument("Dtb của trường rađa là gì?", "trinh-sat-tren-khong");

assert.equal(rankBuiltinChunks(payload, "xin chào").length, 0, "Lời chào không được kích hoạt RAG");
assert.equal(
  rankBuiltinChunks(payload, "Một xe chạy 72 km/h, đổi sang m/s").length,
  0,
  "Câu hỏi phổ thông không liên quan không được kích hoạt kho quân sự",
);

console.log(`OK: ${payload.documents.length} tài liệu, ${payload.chunks.length} đoạn, 5 kiểm thử truy xuất.`);
