import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { chromium } from 'playwright-core';
import { STATE_FILE, PROFILE_DIR, secureJson } from './config.js';

// Visible sign-in uses an ordinary dedicated browser; background capture stays on the exam origin.
const PATHS = {
  darwin: { chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    msedge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '~/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
  win32: { chrome: ['%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe', '%PROGRAMFILES%/Google/Chrome/Application/chrome.exe', '%PROGRAMFILES(X86)%/Google/Chrome/Application/chrome.exe'],
    msedge: ['%PROGRAMFILES(X86)%/Microsoft/Edge/Application/msedge.exe', '%PROGRAMFILES%/Microsoft/Edge/Application/msedge.exe', '%LOCALAPPDATA%/Microsoft/Edge/Application/msedge.exe'] },
  linux: { chrome: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'], msedge: ['/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge'] },
};

export function findBrowser(channel) {
  if (channel === 'chromium') { try { const exe = chromium.executablePath(); return fs.existsSync(exe) ? exe : null; } catch { return null; } }
  const expand = (p) => p.replace(/^~/, os.homedir()).replace(/%([^%]+)%/g, (_, name) => process.env[name] || '\0');
  return (PATHS[process.platform]?.[channel] || []).map(expand).find((p) => !p.includes('\0') && fs.existsSync(p)) || null;
}

// 逐行读取 Chrome --log-net-log 输出：第一行是常量表，之后每行一个事件。只关心请求 URL 和响应状态行。
export class NetLogWatcher {
  constructor(file) { this.file = file; this.offset = 0; this.rest = ''; this.types = null; this.urls = new Map(); }

  read() {
    let fd; try { fd = fs.openSync(this.file, 'r'); } catch { return []; }
    try {
      const { size } = fs.fstatSync(fd);
      if (size <= this.offset) return [];
      const chunk = Buffer.alloc(size - this.offset);
      fs.readSync(fd, chunk, 0, chunk.length, this.offset);
      this.offset = size;
      const lines = (this.rest + chunk.toString('utf8')).split('\n');
      this.rest = lines.pop();
      const out = [];
      for (const line of lines) {
        if (!this.types) {
          if (!line.startsWith('{"constants":')) continue;
          try { const t = JSON.parse(line.slice(0, line.lastIndexOf(',')) + '}').constants.logEventTypes; this.types = { start: t.URL_REQUEST_START_JOB, headers: t.HTTP_TRANSACTION_READ_RESPONSE_HEADERS }; } catch {}
          continue;
        }
        if (!line.startsWith('{')) continue;
        let e; try { e = JSON.parse(line.replace(/,\s*$/, '')); } catch { continue; }
        if (e.type === this.types.start && e.params?.url) this.urls.set(e.source?.id, e.params.url);
        else if (e.type === this.types.headers && this.urls.has(e.source?.id)) {
          const status = Number(String(e.params?.headers?.[0] || '').split(' ')[1]);
          try { out.push({ url: new URL(this.urls.get(e.source.id)), status }); } catch {}
        }
      }
      return out;
    } finally { fs.closeSync(fd); }
  }
}

const quit = (proc) => new Promise((resolve) => {
  if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
  const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 15000);
  proc.once('exit', () => { clearTimeout(timer); resolve(); });
  // SIGINT / WM_CLOSE 让 Chrome 正常退出并把会话 Cookie 写入 profile；SIGTERM 在 macOS 上不会写盘。
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(proc.pid), '/t'], () => {});
  else proc.kill('SIGINT');
});

export class BrowserSession {
  constructor(base, { stateFile = STATE_FILE, profileDir = PROFILE_DIR, launchBrowser = (dir, options) => chromium.launchPersistentContext(dir, options),
    findBrowser: find = findBrowser, spawnBrowser = (exe, args) => spawn(exe, args, { stdio: 'ignore' }), pollMs = 700,
    entryPath = '/', signedIn = () => false,
    prepareContext = async () => {},
    responseHint = () => null,
    validatePage = async () => false,
    captureState = async (context) => ({ cookies: (await context.storageState()).cookies, origins: [] }),
  } = {}) {
    this.base = base;
    this.stateFile = stateFile;
    this.profileDir = profileDir;
    this.pending = null;
    this.lastLoginError = null;
    this.loginStatus = null;
    this.launchBrowser = launchBrowser;
    this.findBrowser = find;
    this.spawnBrowser = spawnBrowser;
    this.pollMs = pollMs;
    this.entryPath = entryPath;
    this.prepareContext = prepareContext;
    this.responseHint = responseHint;
    this.signedIn = signedIn;
    this.validatePage = validatePage;
    this.captureState = captureState;
  }

  state() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw new Error('本地登录状态无法读取，请重新登录。'); }
  }

  cookieHeader(url) {
    const target = new URL(url);
    const now = Date.now() / 1000;
    return (this.state()?.cookies || []).filter((c) => {
      const host = c.domain.replace(/^\./, '');
      const domain = c.domain.startsWith('.') ? target.hostname === host || target.hostname.endsWith(`.${host}`) : target.hostname === host;
      const cookiePath = c.path || '/';
      const path = target.pathname === cookiePath || (target.pathname.startsWith(cookiePath) && (cookiePath.endsWith('/') || target.pathname[cookiePath.length] === '/'));
      return domain && path && (!c.secure || target.protocol === 'https:') && (c.expires === -1 || c.expires > now);
    }).map((c) => `${c.name}=${c.value}`).join('; ');
  }

  updateCookies(response, url) {
    const values = response.headers.getSetCookie?.() || [];
    if (!values.length) return;
    const state = this.state() || { cookies: [], origins: [] };
    const target = new URL(url);
    for (const value of values) {
      const [pair, ...attributes] = value.split(';');
      const sep = pair.indexOf('=');
      if (sep < 1) continue;
      const c = { name: pair.slice(0, sep).trim(), value: pair.slice(sep + 1).trim(), domain: target.hostname,
        path: target.pathname.slice(0, target.pathname.lastIndexOf('/') + 1) || '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' };
      let maxAge;
      for (const a of attributes) {
        const [key, ...rest] = a.trim().split('='); const v = rest.join('=');
        switch (key.toLowerCase()) {
          case 'domain': c.domain = v.startsWith('.') ? v : `.${v}`; break;
          case 'path': c.path = v || '/'; break;
          case 'expires': { const ms = Date.parse(v); if (Number.isFinite(ms)) c.expires = ms / 1000; break; }
          case 'max-age': if (/^-?\d+$/.test(v)) maxAge = Number(v); break;
          case 'secure': c.secure = true; break;
          case 'httponly': c.httpOnly = true; break;
          case 'samesite': if (/^(strict|lax|none)$/i.test(v)) c.sameSite = v[0].toUpperCase() + v.slice(1).toLowerCase(); break;
        }
      }
      const domain = c.domain.replace(/^\./, '');
      if (!(target.hostname === domain || target.hostname.endsWith(`.${domain}`))) continue;
      if (maxAge !== undefined) c.expires = Date.now() / 1000 + maxAge;
      state.cookies = state.cookies.filter((old) => !(old.name === c.name && old.domain.replace(/^\./, '') === domain && old.path === c.path));
      if (c.expires === -1 || c.expires > Date.now() / 1000) state.cookies.push(c);
    }
    secureJson(this.stateFile, state);
  }

  login({ headless = false, timeoutMs = headless ? 15000 : 600000, onProgress = () => {} } = {}) {
    if (this.pending) return this.pending;
    this.lastLoginError = null;
    this.pending = (headless ? this.openLogin({ headless, timeoutMs, onProgress }) : this.openManualLogin({ timeoutMs, onProgress })).catch((e) => {
      this.lastLoginError = e.message;
      this.loginStatus = '登录未完成';
      throw e;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  channels() { return process.env.PAPERBRIDGE_BROWSER ? [process.env.PAPERBRIDGE_BROWSER] : ['chrome', 'msedge', 'chromium']; }

  async openManualLogin({ timeoutMs, onProgress }) {
    const progress = (message) => {
      if (this.loginStatus === message) return;
      this.loginStatus = message;
      onProgress(message);
    };
    progress('正在启动 MCP 专用浏览器…');
    fs.mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });
    const channel = this.channels().find((c) => this.findBrowser(c));
    if (!channel) throw new Error('无法打开登录窗口。请安装 Chrome / Edge。');
    // 网络日志含跳转 URL（不含 Cookie），只放在私有 profile 目录里，结束后删除。
    const netlog = path.join(this.profileDir, 'login-netlog.json');
    fs.rmSync(netlog, { force: true });
    const proc = this.spawnBrowser(this.findBrowser(channel), [`--user-data-dir=${this.profileDir}`, `--log-net-log=${netlog}`,
      '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', this.base + this.entryPath]);
    let exited = false; let spawnError = null;
    proc.once('exit', () => { exited = true; });
    proc.once('error', (e) => { spawnError = e; exited = true; });
    const watcher = new NetLogWatcher(netlog);
    let signedIn = false;
    try {
      progress('浏览器已启动，正在加载学校入口…');
      const deadline = Date.now() + timeoutMs;
      while (!signedIn && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        for (const r of watcher.read()) {
          if (this.signedIn(r, this.base)) { signedIn = true; break; }
          const hint = this.responseHint(r, this.base);
          if (hint) progress(hint);
          if (r.url.hostname === 'uim.xjtlu.edu.cn' && r.status === 200 && r.url.pathname.endsWith('/accountPsw.js')) progress('学校认证表单已显示，请在此专用窗口输入账号密码。');
          if (r.url.hostname === 'uim.xjtlu.edu.cn' && r.status === 400 && r.url.pathname === '/ngw/context') progress('学校认证网关拒绝了此窗口（HTTP 400），登录表单可能不会显示。');
        }
        if (!signedIn && exited) throw new Error(spawnError ? '无法打开登录窗口。请安装 Chrome / Edge。' : '登录窗口已关闭，请重新连接。如果此前已有一个本工具的登录窗口，请先将其关闭。');
      }
      if (!signedIn) throw new Error('等待登录超时，请重试。');
      progress('已检测到登录成功，正在保存 MCP 专用会话（窗口会自动关闭）…');
    } finally {
      await quit(proc);
      fs.rmSync(netlog, { force: true });
    }
    let context;
    try { context = await this.launchBrowser(this.profileDir, { channel, headless: true, args: ['--restore-last-session'], timeout: 20000 }); }
    catch { throw new Error('登录已完成，但无法在后台读取会话。请关闭本工具的浏览器窗口后重试。'); }
    try {
      await this.prepareContext(context);
      const page = context.pages()[0] || await context.newPage();
      await page.goto(this.base + this.entryPath, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!await this.validatePage(page)) throw new Error('登录窗口已关闭，但未读取到有效的学校会话，请重试。');
      secureJson(this.stateFile, await this.captureState(context));
      progress('MCP 专用会话已保存。');
      return { connected: true };
    } finally { await context.close().catch(() => {}); }
  }

}
