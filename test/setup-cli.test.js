import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../bin/paperbridge.js', import.meta.url));
function fixture(t, clients = ['codex', 'deepseek-harness']) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-auto-setup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const files = { codex: path.join(home, '.codex', 'config.toml'), 'deepseek-harness': path.join(home, '.dsh', 'cordis.patch.yml') };
  const prior = { codex: '[mcp_servers.other]\ncommand = "other-node"\n', 'deepseek-harness': '# existing settings\n- id: theme\n  disabled: false\n' };
  for (const client of clients) {
    fs.mkdirSync(path.dirname(files[client]), { recursive: true });
    fs.writeFileSync(files[client], prior[client]);
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home, PAPERBRIDGE_HOME: path.join(home, 'state'), DSH_HOME: path.join(home, '.dsh'), KIMI_CODE_HOME: path.join(home, '.kimi-code'), APPDATA: path.join(home, 'AppData'), PATH: path.join(home, 'empty-path') };
  return { home, files, prior, run: (...args) => spawnSync(process.execPath, [cli, 'setup', '--no-install', '--no-login', ...args], { env, cwd: home, input: '', encoding: 'utf8', timeout: 10000 }) };
}

test('setup automatically connects Codex and Harness without input, backs up settings, and stays idempotent', (t) => {
  const f = fixture(t);
  const cursor = path.join(f.home, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursor)); fs.writeFileSync(cursor, '{"mcpServers":{}}');
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stderr, /Y\/n|接入.*？|非交互安装/);
  const after = {};
  for (const id of Object.keys(f.files)) {
    const file = f.files[id];
    after[id] = fs.readFileSync(file, 'utf8');
    assert.ok(after[id].includes(f.prior[id]));
    assert.match(after[id], /paperbridge/);
    const backups = fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.before-paperbridge-'));
    assert.equal(backups.length, 1);
    const backup = path.join(path.dirname(file), backups[0]);
    assert.equal(fs.readFileSync(backup, 'utf8'), f.prior[id]);
    if (process.platform !== 'win32') assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  }
  assert.equal(fs.readFileSync(cursor, 'utf8'), '{"mcpServers":{}}');
  const second = f.run('--yes');
  assert.equal(second.status, 0, second.stderr);
  for (const id of Object.keys(f.files)) {
    assert.equal(fs.readFileSync(f.files[id], 'utf8'), after[id]);
    assert.equal(fs.readdirSync(path.dirname(f.files[id])).filter((name) => name.includes('.before-paperbridge-')).length, 1);
  }
});

for (const id of ['codex', 'deepseek-harness']) test(`setup connects only the detected ${id}`, (t) => {
  const f = fixture(t, [id]);
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.files[id], 'utf8'), /paperbridge/);
  const absent = id === 'codex' ? 'deepseek-harness' : 'codex';
  assert.equal(fs.existsSync(f.files[absent]), false);
});

test('setup still honors an explicit client choice', (t) => {
  const f = fixture(t);
  const result = f.run('--clients', 'codex'); assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.files.codex, 'utf8'), /paperbridge/);
  assert.equal(fs.readFileSync(f.files['deepseek-harness'], 'utf8'), f.prior['deepseek-harness']);
});
