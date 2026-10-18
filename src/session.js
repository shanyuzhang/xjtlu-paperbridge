import path from 'node:path';
import { DATA_DIR } from './config.js';
import { BrowserSession } from './browser-session.js';

export const EXAM_BASE = 'https://etd.xjtlu.edu.cn';
export const EXAM_ENTRY = '/index.html#/Policy/EXAMXJTLU';

export class ExamLoginRequired extends Error {
  constructor() {
    super('试卷库尚未登录或登录已失效。请调用 paperbridge_login，在专用窗口完成学校登录、本人确认使用协议，并搜索一次课程代码；随后用 paperbridge_status 检查。也可运行 paperbridge login。');
    this.code = 'LOGIN_REQUIRED';
  }
}

export function stateToken(state, base = EXAM_BASE) {
  const value = state?.origins?.find((o) => o.origin === base)?.localStorage?.find((v) => v.name === 'token')?.value;
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value) || value.length > 16384) return null;
  return value;
}

export class ExamSession extends BrowserSession {
  constructor({ base = EXAM_BASE, dataDir = DATA_DIR, ...options } = {}) {
    super(base, {
      stateFile: path.join(dataDir, 'session.json'), profileDir: path.join(dataDir, 'login-browser'),
      entryPath: EXAM_ENTRY,
      responseHint: ({ url, status }, origin) => status === 200 && url.origin === origin && url.pathname === '/token'
        ? '学校账号已登录，请点击 Past Exam Papers，由本人确认协议后搜索一次课程代码。' : null,
      prepareContext: (context) => context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort()),
      // The search request follows the user's own sign-in and agreement confirmation.
      signedIn: ({ url, status }, origin) => status === 200 && url.origin === origin && url.pathname.toLowerCase() === '/api/v1/search/search',
      validatePage: async (page) => {
        await page.waitForFunction(() => !!localStorage.getItem('token'), null, { timeout: 10000 }).catch(() => {});
        return !!stateToken(await page.context().storageState(), base);
      },
      captureState: async (context) => {
        const state = await context.storageState();
        const token = stateToken(state, base);
        if (!token) throw new ExamLoginRequired();
        return {
          cookies: state.cookies.filter((c) => { const host = c.domain.replace(/^\./, ''); return new URL(base).hostname === host || (c.domain.startsWith('.') && new URL(base).hostname.endsWith(`.${host}`)); }),
          origins: [{ origin: base, localStorage: [{ name: 'token', value: token }] }],
        };
      },
      ...options,
    });
  }

  token() { return stateToken(this.state(), this.base); }

  // An expired exam session requires the student's normal browser; never send a headless browser into SSO.
  async openLogin() { throw new ExamLoginRequired(); }
}
