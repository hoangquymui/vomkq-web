import assert from "node:assert/strict";
import { treeLayout, reparent, canReparent, removeGrouping, knowledgeProjection, knowledgeNodeId, knowledgeFolderNodeId, moveCatalogDocument, moveCatalogFolder, removeCatalogFolder } from "../src/dataset-tree-model.js";

const nodes = [
  { id: "root", parent_id: null, title: "Sổ tay", kind: "document" },
  { id: "chapter", parent_id: "root", title: "Chương", kind: "chapter" },
  { id: "section", parent_id: "chapter", title: "Mục 34", kind: "section" },
  ...["concept", "standard", "formula", "table", "note"].map((kind) => ({ id: kind, kind, parent_id: "section", title: kind })),
  { id: "source", parent_id: "formula", title: "Nguồn thật", kind: "chunk", chunk_id: "original" },
  { id: "child", parent_id: "source", title: "Lớp con", kind: "note" },
];
const layout = treeLayout(nodes);
assert.equal(layout.edges.length, nodes.length - 1);
assert.equal(layout.nodes.find((n) => n.id === "child").depth, 5);
for (const a of layout.nodes) for (const b of layout.nodes) if (a.id !== b.id && a.depth === b.depth) assert.ok(Math.abs(a.y - b.y) >= 88);
assert.equal(canReparent(nodes, "section", "source"), false);
assert.equal(canReparent(nodes, "root", "chapter"), false);
const moved = reparent(nodes, "formula", "chapter");
assert.equal(moved.find((n) => n.id === "formula").parent_id, "chapter");
assert.equal(moved.find((n) => n.id === "source").chunk_id, "original");
const removed = removeGrouping(nodes, "formula");
assert.equal(removed.find((n) => n.id === "source").parent_id, "section");
assert.throws(() => removeGrouping(nodes, "source"));
assert.throws(() => removeGrouping(nodes, "root"));
const collapsed = treeLayout(nodes.map((n) => ({ ...n, collapsed: n.id === "section" })));
assert.equal(collapsed.nodes.length, 3);
console.log("PASS: deep hierarchy, non-overlapping layout, branch move, cycle guard, source preservation, collapse");

const documents = [{ id:"book", version:1, title:"Sổ tay" }, { id:"book", version:2, title:"Sổ tay" }, { id:'other:"book', version:1, title:"Tài liệu khác", enabled:false }];
const snapshot = JSON.stringify(nodes);
const overview = treeLayout(knowledgeProjection(documents));
assert.equal(overview.nodes[0].title, "Kho Kiến Thức");
assert.equal(overview.nodes.length, 4);
assert.equal(overview.edges.filter((e) => e.from.kind === "knowledge").length, 3);
const combined = knowledgeProjection(documents, { document_id:"book", document_version:1, nodes });
assert.equal(new Set(combined.map((n) => n.id)).size, combined.length);
assert.equal(combined.find((n) => n.localId === "child").parent_id, knowledgeNodeId("book",1,"source"));
assert.equal(combined.find((n) => n.localId === "root").parent_id, "root");
assert.equal(combined.filter((n) => n.localId).length, nodes.length);
assert.equal(JSON.stringify(nodes), snapshot, "Projection must not mutate persisted parents or IDs");
assert.equal(treeLayout(knowledgeProjection([])).nodes.length, 1);
console.log("PASS: knowledge root connects all documents, scoped IDs, unchanged document trees, empty knowledge base");

let catalog = {revision:0, folders:[{id:"manuals",title:"SỔ TAY",parent_id:null,collapsed:false},{id:"field",title:"Dã ngoại",parent_id:"manuals",collapsed:false}], documents:[]};
catalog = moveCatalogDocument(catalog, "book", 1, "manuals");
let organized = knowledgeProjection(documents, null, catalog);
assert.equal(organized.find((n) => n.documentIndex === 0).parent_id, knowledgeFolderNodeId("manuals"));
assert.equal(organized.find((n) => n.catalogFolderId === "field").parent_id, knowledgeFolderNodeId("manuals"));
assert.throws(() => moveCatalogFolder(catalog, "manuals", "field"));
catalog = removeCatalogFolder(catalog, "manuals");
assert.equal(catalog.folders.find((folder) => folder.id === "field").parent_id, null);
assert.equal(catalog.documents.find((item) => item.document_id === "book").parent_id, null);
console.log("PASS: knowledge folders group documents, support nesting, prevent cycles, and promote children safely");
