import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { upsertCodexToml } from '../src/setup.js';

test('Codex configuration preserves course assistant and replaces only PaperBridge', () => {
  const prior = '[mcp_servers.xjtlu-core]\ncommand="course-node"\n[mcp_servers.paperbridge]\ncommand="old"\n[mcp_servers.paperbridge.env]\nOLD="value"\n[mcp_servers.other]\ncommand="other-node"\n';
  const next = upsertCodexToml(prior, { command: '/new/node', args: ['/new/paperbridge.js', 'serve'] });
  assert.match(next, /command="course-node"/); assert.match(next, /command="other-node"/);
  assert.equal((next.match(/\[mcp_servers.paperbridge\]/g) || []).length, 1);
  assert.doesNotMatch(next, /OLD=/); assert.match(next, /command = "\/new\/node"/);
});

test('fresh stdio server exposes exactly five standalone tools without reading the old session', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-standalone-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.xjtlu-session-mcp'));
  fs.writeFileSync(path.join(home, '.xjtlu-session-mcp', 'exam-session.json'), '{"private":"old-session-must-not-be-read"}');
  const cli = fileURLToPath(new URL('../bin/paperbridge.js', import.meta.url));
  const mcp = new Client({ name: 'standalone-test', version: '1' });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'serve'], env: { ...process.env, HOME: home, USERPROFILE: home, PAPERBRIDGE_HOME: path.join(home, '.paperbridge') }, stderr: 'pipe' }));
    const { tools } = await mcp.listTools();
    assert.deepEqual(tools.map((x) => x.name).sort(), ['paperbridge_details', 'paperbridge_download', 'paperbridge_login', 'paperbridge_search', 'paperbridge_status']);
    const result = await mcp.callTool({ name: 'paperbridge_status', arguments: {} });
    assert.equal(JSON.parse(result.content[0].text).connected, false);
    assert.doesNotMatch(JSON.stringify(result), /old-session-must-not-be-read/);
  } finally { await mcp.close(); }
});
