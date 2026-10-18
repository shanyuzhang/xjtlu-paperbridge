import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DATA_DIR = process.env.PAPERBRIDGE_HOME || path.join(os.homedir(), '.paperbridge');
export const STATE_FILE = path.join(DATA_DIR, 'session.json');
export const PROFILE_DIR = path.join(DATA_DIR, 'login-browser');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function readConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error('PaperBridge 本地配置无法读取，请检查 config.json。');
  }
}

export function secureJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function configure(patch) { secureJson(CONFIG_FILE, { ...readConfig(), ...patch }); }

export function settings() {
  return { downloads: path.resolve(process.env.PAPERBRIDGE_DOWNLOADS || readConfig().downloads || process.cwd()) };
}
