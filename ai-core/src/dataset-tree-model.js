// Pure dataset-tree operations, shared by the editor and regression tests.
export const DATASET_KINDS = {
  knowledge: "Kho tài liệu",
  folder: "Thư mục",
  document: "Tài liệu", part: "Phần", chapter: "Chương", section: "Mục", concept: "Khái niệm",
  standard: "Tiêu chuẩn", formula: "Công thức", table: "Bảng", note: "Ghi chú",
  group: "Nhóm nội dung", chunk: "Chưa phân loại",
};
export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 88;

// Presentation-only root. Persisted document trees and their local IDs remain
// independent; the knowledge hub must never be sent to a document's save API.
export const knowledgeNodeId = (documentId, version, localId = "root") => `document:${JSON.stringify([documentId, version, localId])}`;
export const knowledgeFolderNodeId = (folderId) => `folder:${JSON.stringify(folderId)}`;

export function knowledgeProjection(documents, activeTree = null, catalog = null) {
  const nodes = [{ id: "root", parent_id: null, title: "Kho Kiến Thức", kind: "knowledge", collapsed: false }];
  const folders = Array.isArray(catalog?.folders) ? catalog.folders : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const assignments = new Map((catalog?.documents || []).map((item) => [`${item.document_id}\u0000${item.document_version}`, item.parent_id]));
  for (const folder of folders) nodes.push({
    ...folder,
    id: knowledgeFolderNodeId(folder.id),
    parent_id: folder.parent_id && folderIds.has(folder.parent_id) ? knowledgeFolderNodeId(folder.parent_id) : "root",
    kind: "folder", catalogFolderId: folder.id,
  });
  documents.forEach((doc, documentIndex) => {
    const active = activeTree?.document_id === doc.id && activeTree?.document_version === doc.version;
    const source = active ? activeTree.nodes : [{ id: "root", parent_id: null, title: doc.title, kind: "document", collapsed: true }];
    const folderId = assignments.get(`${doc.id}\u0000${doc.version}`);
    const documentParent = folderId && folderIds.has(folderId) ? knowledgeFolderNodeId(folderId) : "root";
    for (const node of source) nodes.push({
      ...node,
      id: knowledgeNodeId(doc.id, doc.version, node.id),
      parent_id: node.parent_id == null ? documentParent : knowledgeNodeId(doc.id, doc.version, node.parent_id),
      localId: active ? node.id : null,
      documentIndex, documentVersion: doc.version,
      enabled: doc.enabled !== false,
      unloaded: !active,
    });
  });
  return nodes;
}

export function catalogFolderDescendants(folders, id) {
  const result = new Set(), stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...folders.filter((folder) => folder.parent_id === current).map((folder) => folder.id));
  }
  return result;
}

export function moveCatalogFolder(catalog, id, parentId) {
  if (!catalog.folders.some((folder) => folder.id === id)) throw new Error("Không tìm thấy thư mục.");
  if (parentId != null && !catalog.folders.some((folder) => folder.id === parentId)) throw new Error("Không tìm thấy thư mục cha.");
  if (catalogFolderDescendants(catalog.folders, id).has(parentId)) throw new Error("Không thể đặt thư mục vào chính nó hoặc thư mục con.");
  return { ...catalog, folders: catalog.folders.map((folder) => folder.id === id ? { ...folder, parent_id: parentId } : folder) };
}

export function moveCatalogDocument(catalog, documentId, version, parentId) {
  if (parentId != null && !catalog.folders.some((folder) => folder.id === parentId)) throw new Error("Không tìm thấy thư mục chứa.");
  const key = (item) => item.document_id === documentId && Number(item.document_version) === Number(version);
  const documents = catalog.documents.filter((item) => !key(item));
  documents.push({ document_id: documentId, document_version: Number(version), parent_id: parentId });
  return { ...catalog, documents };
}

export function removeCatalogFolder(catalog, id) {
  const folder = catalog.folders.find((item) => item.id === id);
  if (!folder) throw new Error("Không tìm thấy thư mục.");
  return {
    ...catalog,
    folders: catalog.folders.filter((item) => item.id !== id).map((item) => item.parent_id === id ? { ...item, parent_id: folder.parent_id } : item),
    documents: catalog.documents.map((item) => item.parent_id === id ? { ...item, parent_id: folder.parent_id } : item),
  };
}

export function childrenMap(nodes) {
  const map = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) if (n.parent_id != null) map.get(n.parent_id)?.push(n);
  return map;
}

export function descendants(nodes, id) {
  const map = childrenMap(nodes), result = new Set(), stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...(map.get(current) || []).map((n) => n.id));
  }
  return result;
}

export function canReparent(nodes, id, parentId) {
  return id !== "root" && nodes.some((n) => n.id === id) && nodes.some((n) => n.id === parentId)
    && !descendants(nodes, id).has(parentId);
}

export function reparent(nodes, id, parentId) {
  if (!canReparent(nodes, id, parentId)) throw new Error("Không thể nối mục vào chính nó hoặc nhánh con của nó.");
  const result = nodes.filter((n) => n.id !== id).map((n) => n.id === parentId ? { ...n, collapsed: false } : n);
  result.push({ ...nodes.find((n) => n.id === id), parent_id: parentId });
  return result;
}

export function removeGrouping(nodes, id) {
  const node = nodes.find((n) => n.id === id);
  if (!node || node.id === "root" || node.chunk_id) throw new Error("Không xóa nguồn gốc từ sơ đồ tổ chức.");
  // Children, including all source links, survive deletion of a heading.
  return nodes.filter((n) => n.id !== id).map((n) => n.parent_id === id ? { ...n, parent_id: node.parent_id } : n);
}

export function treeLayout(nodes) {
  const children = childrenMap(nodes), byId = new Map(nodes.map((n) => [n.id, n]));
  const root = byId.get("root");
  if (!root) return { nodes: [], edges: [], width: 600, height: 400 };
  const visit = [{ node: root, depth: 0 }], order = [], visited = new Set();
  while (visit.length) {
    const item = visit.pop();
    if (visited.has(item.node.id)) continue;
    visited.add(item.node.id); order.push(item);
    if (!item.node.collapsed) for (const child of [...children.get(item.node.id)].reverse()) visit.push({ node: child, depth: item.depth + 1 });
  }
  const spans = new Map();
  for (const { node } of [...order].reverse()) {
    const visibleChildren = node.collapsed ? [] : children.get(node.id);
    spans.set(node.id, Math.max(112, visibleChildren.reduce((sum, c) => sum + (spans.get(c.id) || 112), 0)));
  }
  const tops = new Map([["root", 32]]), placed = [], positions = new Map();
  for (const { node, depth } of order) {
    const top = tops.get(node.id), y = top + (spans.get(node.id) - NODE_HEIGHT) / 2;
    const p = { ...node, x: 32 + depth * 288, y, depth, childCount: children.get(node.id).length };
    placed.push(p); positions.set(node.id, p);
    let next = top;
    for (const child of children.get(node.id)) { tops.set(child.id, next); next += spans.get(child.id) || 112; }
  }
  const edges = placed.filter((n) => n.parent_id && positions.has(n.parent_id)).map((n) => ({ from: positions.get(n.parent_id), to: n }));
  return { nodes: placed, edges, width: Math.max(640, ...placed.map((n) => n.x + NODE_WIDTH + 40)), height: Math.max(380, spans.get("root") + 64) };
}
