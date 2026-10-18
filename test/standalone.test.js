import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { upsertCodexToml } from '../src/setup.js';

test('CLI defaults to the caller folder and a one-off destination does not overwrite saved preferences', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-destination-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, PAPERBRIDGE_HOME: path.join(home, 'state') };
  delete env.PAPERBRIDGE_DOWNLOADS;
  const configUrl = new URL('../src/config.js', import.meta.url).href;
  const readSettings = () => spawnSync(process.execPath, ['--input-type=module', '-e', `import {settings} from ${JSON.stringify(configUrl)}; console.log(JSON.stringify(settings()));`], { cwd: home, env, encoding: 'utf8' });
  const initial = readSettings(); assert.equal(initial.status, 0);
  assert.equal(JSON.parse(initial.stdout).downloads, fs.realpathSync(home));
  fs.mkdirSync(env.PAPERBRIDGE_HOME);
  const configFile = path.join(env.PAPERBRIDGE_HOME, 'config.json');
  const saved = JSON.stringify({ downloads: path.join(home, 'chosen default') });
  fs.writeFileSync(configFile, saved);
  assert.equal(JSON.parse(readSettings().stdout).downloads, path.join(home, 'chosen default'));
  const cli = fileURLToPath(new URL('../bin/paperbridge.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'download', 'invalid-id', '--downloads', './one-off'], { cwd: home, env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /试卷 ID/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), saved);
  assert.equal(fs.existsSync(path.join(home, 'one-off')), false);
});

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
