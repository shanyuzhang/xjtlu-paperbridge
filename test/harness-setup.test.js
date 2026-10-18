import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { upsertHarnessPatch } from '../src/harness.js';
import { targets, installTarget } from '../src/setup.js';

const launch = { command: 'C:\\Program Files\\node.exe', args: ['C:\\My App\\paperbridge.js', 'serve'] };

test('Harness is detected from its home, DSH_HOME, or CLI without assuming desktop paths', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xjtlu-harness-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const find = (env = {}, onPath = () => false) => targets(home, 'linux', { env, onPath }).find((x) => x.id === 'deepseek-harness');
  assert.equal(find(), undefined);
  fs.mkdirSync(path.join(home, '.dsh'));
  assert.equal(find().file, path.join(home, '.dsh', 'cordis.patch.yml'));
  const custom = path.join(home, 'custom'); fs.mkdirSync(custom);
  assert.equal(find({ DSH_HOME: custom }).file, path.join(custom, 'cordis.patch.yml'));
  fs.rmSync(path.join(home, '.dsh'), { recursive: true });
  assert.equal(find({}, (cmd) => cmd === 'dsh').file, path.join(home, '.dsh', 'cordis.patch.yml'));
});

test('Harness merge keeps other plugins, comments and unevaluated !!js; repeat installs replace only launch', () => {
  const prior = '# personal settings\n- id: model\n  config:\n    key: !!js process.env.PRIVATE_KEY\n- insert:\n    - id: other\n      name: another-plugin\n      config: { value: yes }\n';
  const first = upsertHarnessPatch(prior, launch);
  assert.match(first, /# personal settings/);
  assert.match(first, /!!js process.env.PRIVATE_KEY/);
  assert.equal(parseDocument(first).errors.length, 0);
  const rows = parseDocument(first).toJS();
  assert.equal(rows[1].insert[0].name, 'another-plugin');
  assert.deepEqual(rows[2].insert[0].config, { serverName: 'paperbridge', transport: 'stdio', ...launch });
  const nextLaunch = { command: '/new/node', args: ['/new/cli.js', 'serve'] };
  const second = upsertHarnessPatch(first, nextLaunch);
  assert.equal((second.match(/id: mcp-paperbridge/g) || []).length, 1);
  assert.deepEqual(parseDocument(second).toJS()[2].insert[0].config, { serverName: 'paperbridge', transport: 'stdio', ...nextLaunch });
  assert.equal(upsertHarnessPatch(second, nextLaunch), second);
});

test('Harness merge rejects invalid documents and conflicting registrations without exposing their contents', () => {
  for (const text of ['config: private-value', '- secret: [private-value', '- 42', '---\n[]\n---\n[]']) {
    assert.throws(() => upsertHarnessPatch(text, launch), (e) => !e.message.includes('private-value'));
  }
  for (const text of [
    '- insert:\n    - id: mcp-paperbridge\n      name: other-plugin\n',
    '- insert:\n    - id: custom\n      name: "@deepseek-ai/dsh-mcp-client"\n      config: { serverName: paperbridge }\n',
  ]) assert.throws(() => upsertHarnessPatch(text, launch), /冲突/);
});

test('Harness installer creates a private backup and leaves malformed files untouched', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xjtlu-harness-backup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, 'cordis.patch.yml');
  const prior = '# existing\n- id: theme\n  disabled: false\n';
  fs.writeFileSync(file, prior);
  const target = { file, format: 'harness' };
  const { backup } = installTarget(target, launch);
  assert.equal(fs.readFileSync(backup, 'utf8'), prior);
  assert.equal(parseDocument(fs.readFileSync(file, 'utf8')).toJS()[0].id, 'theme');
  const installedFiles = fs.readdirSync(home);
  assert.equal(installTarget(target, launch).backup, null);
  assert.deepEqual(fs.readdirSync(home), installedFiles);
  if (process.platform !== 'win32') assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  fs.writeFileSync(file, 'not: a-list');
  const before = fs.readdirSync(home);
  assert.throws(() => installTarget(target, launch), /未修改/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'not: a-list');
  assert.deepEqual(fs.readdirSync(home), before);
});
