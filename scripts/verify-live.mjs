// Run through the real stdio MCP boundary; never print session data or paper contents.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getDocumentProxy } from 'unpdf';
import { courseCode } from '../src/client.js';

const { values } = parseArgs({ options: { 'course-code': { type: 'string' }, 'record-id': { type: 'string' } } });
if (!values['course-code']) throw new Error('请提供 --course-code，例如 FIN104；此验证会保存一份试卷到本机。');
const code = courseCode(values['course-code']);
const client = new Client({ name: 'verify-exams-live', version: '1' });
const cli = fileURLToPath(new URL('../bin/paperbridge.js', import.meta.url));
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  if (response.isError) throw new Error(response.content[0].text);
  return JSON.parse(response.content[0].text);
}
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'serve'], env: process.env, stderr: 'inherit' }));
  const tools = (await client.listTools()).tools.filter((t) => t.name.startsWith('paperbridge_'));
  if (tools.length !== 5) throw new Error('未找到完整的试卷工具。');
  if (!(await call('paperbridge_status')).connected) throw new Error('请先运行 node bin/paperbridge.js login 完成试卷库登录。');
  let selected; let page = 1;
  do {
    const result = await call('paperbridge_search', { course_code: code, page });
    console.log(JSON.stringify({ course_code: code, total: result.total, page, matches: result.items.length }));
    selected = values['record-id'] ? result.items.find((p) => p.record_id === values['record-id']) : result.items[0];
    page = result.next_page;
  } while (!selected && page);
  if (!selected) throw new Error('未找到可验证的匹配试卷。');
  const metadata = await call('paperbridge_details', { record_ids: [selected.record_id] });
  if (!metadata.items.length) throw new Error(metadata.failed[0]?.error || '无法读取试卷详情。');
  const result = await call('paperbridge_download', { record_ids: [selected.record_id], download_dir: process.cwd() });
  if (!result.saved.length) throw new Error(result.failed[0]?.error || '未保存文件。');
  const saved = result.saved[0];
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(saved.path)));
  try { console.log(JSON.stringify({ ok: true, course_code: code, record_id: saved.record_id, bytes: saved.size, pages: pdf.numPages, path: saved.path })); }
  finally { await pdf.destroy?.(); }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await client.close(); }
