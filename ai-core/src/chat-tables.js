import { escapeContent, parseKnowledge, renderKnowledge } from "./knowledge-content.js";

// Stash tables before the chat renderer handles math/line breaks. In particular,
// KaTeX HTML must never be split into cells, and <br> is only allowed inside cells.
// parseKnowledge also keeps table-looking text inside code fences as code.
export function prepareChatTables(source, blocks) {
  return parseKnowledge(source).map((block) => {
    if (block.type !== "table" || block.align.length !== block.rows[0].length) return escapeContent(block.raw);
    const key = `@@B${blocks.length}@@`;
    const html = renderKnowledge(block.raw).replace(
      'class="knowledge-table-scroll"',
      'class="knowledge-table-scroll chat-table-scroll"',
    );
    blocks.push(html);
    // Block boundaries keep the resulting <table> outside surrounding <p> tags.
    return `\n\n${key}\n\n`;
  }).join("");
}
