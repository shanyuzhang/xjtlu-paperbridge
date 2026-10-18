import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'install.sh');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge bootstrap '));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const bin = path.join(folder, 'bin'); fs.mkdirSync(bin);
  const home = path.join(folder, 'private home');
  const log = path.join(folder, 'calls');
  const command = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body, { mode: 0o755 });
  command('uname', 'if [ "$1" = -s ]; then printf Linux; else printf x86_64; fi\n');
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, PAPERBRIDGE_HOME: home, PAPERBRIDGE_NO_LOGIN: '1', PB_TEST_LOG: log };
  return { folder, bin, home, log, command, env };
}

test('bootstrap reuses Node, retries registry preparation, and preserves spaced paths and arguments', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  f.command('node', 'printf "22\\n"\n');
  f.command('curl', 'exit 99\n');
  f.command('npm', 'printf "CALL\\n%s\\n" "$npm_config_cache" >> "$PB_TEST_LOG"\nprintf "%s\\n" "$@" >> "$PB_TEST_LOG"\ncase "$*" in *--registry=https://registry.npmjs.org*--help*) exit 1;; esac\nexit 0\n');
  const download = path.join(f.folder, 'PDF files');
  const result = spawnSync('/bin/bash', [script, '--downloads', download], { env: f.env, encoding: 'utf8', input: '' });
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(f.log, 'utf8').split('CALL\n').filter(Boolean);
  assert.equal(calls.length, 3);
  assert.match(calls[1], /--registry=https:\/\/registry.npmmirror.com/);
  assert.ok(calls[2].includes(`setup\n--yes\n--clients\ncodex,deepseek-harness\n--no-login\n--downloads\n${download}\n`));
  assert.ok(calls.every((c) => c.startsWith(path.join(f.home, 'npm-cache') + '\n')));
  assert.equal(fs.existsSync(path.join(f.home, 'node')), false);
});

test('bootstrap reuses its private Node when the system version is too old', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  f.command('node', 'printf "18\\n"\n'); f.command('npm', 'exit 99\n'); f.command('curl', 'exit 99\n');
  const privateBin = path.join(f.home, 'node', 'bin'); fs.mkdirSync(privateBin, { recursive: true });
  fs.writeFileSync(path.join(privateBin, 'node'), '#!/bin/sh\nprintf "24\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(privateBin, 'npm'), '#!/bin/sh\nprintf "private-node\\n" >> "$PB_TEST_LOG"\n', { mode: 0o755 });
  const result = spawnSync('/bin/bash', [script], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(f.log, 'utf8').trim().split('\n'), ['private-node', 'private-node']);
});

test('bootstrap rejects a tampered Node archive before extraction or execution', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  f.command('node', 'printf "18\\n"\n'); f.command('npm', 'exit 99\n');
  f.command('curl', 'while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf "tampered archive" > "$1"; exit 0; fi; shift; done\nexit 2\n');
  f.command('tar', 'printf "must-not-extract" > "$PB_TEST_LOG"\nexit 99\n');
  const result = spawnSync('/bin/bash', [script], { env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /校验失败/);
  assert.equal(fs.existsSync(f.log), false); assert.equal(fs.existsSync(path.join(f.home, 'node')), false);
});

test('Windows bootstrap preserves UTF-8 in an ASCII wrapper and pins official Node checksums', () => {
  const wrapper = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'scripts/bootstrap/install.ps1'), 'utf8');
  assert.doesNotMatch(wrapper, /[^\x00-\x7f]/);
  const encoded = wrapper.match(/FromBase64String\('([^']+)'\)/)?.[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), source);
  const release = JSON.parse(fs.readFileSync(path.join(root, 'scripts/bootstrap/node-release.json')));
  const unix = fs.readFileSync(script, 'utf8');
  for (const [file, sha] of Object.entries(release.sha256)) {
    assert.match(sha, /^[a-f0-9]{64}$/);
    assert.ok((file.includes('-win-') ? source : unix).includes(sha));
  }
  assert.ok(source.includes(release.version)); assert.ok(unix.includes(release.version));
  assert.doesNotMatch(source, /^\s*exit\b/m);
});
