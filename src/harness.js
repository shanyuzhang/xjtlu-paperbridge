import { parseDocument, isMap, isSeq, visit } from 'yaml';

const ID = 'mcp-paperbridge';
const PLUGIN = '@deepseek-ai/dsh-mcp-client';

export function upsertHarnessPatch(text, launch) {
  // Work on YAML nodes so existing comments and !!js expressions remain data,
  // never evaluated JavaScript. Do not include parser excerpts in errors.
  const doc = parseDocument(text.trim() ? text : '[]', { prettyErrors: false });
  if (doc.errors.length || !isSeq(doc.contents) || doc.contents.items.some((node) => !isMap(node))) {
    throw new Error('Harness 配置必须是有效的 YAML patch 列表，未修改。');
  }
  const row = { id: ID, name: PLUGIN, config: { serverName: 'paperbridge', transport: 'stdio', ...launch } };
  let owned;
  for (const patch of doc.contents.items) {
    const insert = patch.get('insert', true);
    if (!isSeq(insert)) continue;
    for (const node of insert.items) {
      if (isMap(node) && node.get('id') === ID && node.get('name') === PLUGIN) {
        if (owned) throw new Error('Harness 中有重复的PaperBridge 插件配置，未修改。');
        owned = node;
      }
    }
  }
  visit(doc, { Map(_key, node) {
    if (node === owned) return;
    if (node.get('id') === ID || (node.get('name') === PLUGIN && node.getIn(['config', 'serverName']) === 'paperbridge')) {
      throw new Error('Harness 已有冲突的PaperBridge MCP 配置，请先检查，未修改。');
    }
  } });
  if (owned) owned.set('config', doc.createNode(row.config));
  else doc.contents.add(doc.createNode({ insert: [row] }));
  return doc.toString();
}
