import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { htmlToText } from 'html-to-text';
import { settings } from './config.js';
import { safeName } from './files.js';
import { ExamSession, ExamLoginRequired, EXAM_BASE } from './session.js';
import { examFetch } from './http.js';

const MAX_BYTES = 60 * 1024 * 1024;
const API_PATH = /^\/api\/v1\/(?:Search\/(?:DbList|Search)|Detail|file\/BrowserUrl\/\d+|File\/BrowserFile)$/i;
const clean = (v) => htmlToText(String(v ?? ''), { wordwrap: false }).trim();
const id = (v) => { const text = String(v); if (!/^\d{1,20}$/.test(text)) throw new Error('试卷 ID 必须为数字。'); return text; };

export function courseCode(value) {
  const code = String(value).trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{2,6}\d{3}[A-Z]{0,3}$/.test(code)) throw new Error('请输入课程代码，例如 MTH129 或 CPT203。');
  return code;
}

export function examUrl(value, base) {
  const url = new URL(value, base);
  if (url.origin !== base || url.username || url.password || url.hash || !API_PATH.test(url.pathname)) throw new Error('试卷库返回了非允许的资源地址。');
  return url;
}

async function body(response, max = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('试卷响应超过 60 MB 限制。'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error('试卷响应超过 60 MB 限制。'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

function paper(record) {
  const type = clean(record.typeABB);
  return {
    record_id: id(record.syS_FLD_SYSID), course_code: clean(record.paperCode),
    title: clean(record.paperTitle), year: clean(record.year),
    semester: clean(record.semsterABB) || null, exam_type_code: type || null,
    exam_type: ({ F: 'Final', R: 'Resit' })[type] || type || null,
  };
}

export class ExamClient {
  constructor({ base = EXAM_BASE, session, downloads, fetchImpl = examFetch } = {}) {
    this.base = new URL(base).origin;
    if (new URL(base).protocol !== 'https:' && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(this.base)) throw new Error('试卷库必须使用 HTTPS。');
    this.session = session || new ExamSession({ base: this.base });
    this.downloads = downloads || settings().downloads;
    this.fetch = fetchImpl;
    this.queue = Promise.resolve();
  }

  async request(value, data) {
    const url = examUrl(value, this.base);
    if (data && url.pathname !== '/api/v1/Search/Search') throw new Error('仅允许试卷检索使用 POST。');
    const token = this.session.token(); const cookie = this.session.cookieHeader(url.href);
    if (!token || !cookie) throw new ExamLoginRequired();
    let response;
    try {
      response = await this.fetch(url, { method: data ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(45000),
        headers: { Cookie: cookie, Authorization: `bearer ${token}`, Referer: `${this.base}/`, Origin: this.base,
          Accept: 'application/json, application/pdf', ...(data ? { 'Content-Type': 'application/json' } : {}) },
        body: data ? JSON.stringify(data) : undefined });
    } catch { throw new Error('无法连接试卷库，请检查学校网络或 VPN。'); }
    this.session.updateCookies?.(response, url.href);
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) { await response.body?.cancel(); throw new ExamLoginRequired(); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`试卷库返回 HTTP ${response.status}。`); }
    return { buffer: await body(response), contentType: response.headers.get('content-type') || '' };
  }

  async json(value, data) {
    const result = await this.request(value, data);
    let payload;
    try { payload = JSON.parse(result.buffer.toString('utf8')); }
    catch { throw new ExamLoginRequired(); }
    if (payload === null) throw new ExamLoginRequired();
    if (payload?.isSuccess === false) {
      if (/登录|非法请求|token|unauthori|expired/i.test(String(payload.errorInfo || ''))) throw new ExamLoginRequired();
      throw new Error('试卷库未允许此查询，请在学校网页确认访问权限。');
    }
    return payload;
  }

  async database() {
    const list = await this.json('/api/v1/Search/DbList');
    if (!Array.isArray(list)) throw new ExamLoginRequired();
    const db = list.find((d) => d.databasecode === 'EXAMXJTLU');
    if (!db) throw new Error('当前账号未开放历年试卷库。');
    return { dbId: id(db.sysid), dbCode: 'EXAMXJTLU' };
  }

  async status() {
    if (this.session.pending) return { connected: false, login_pending: true, message: this.session.loginStatus || '请在专用浏览器完成登录、本人确认试卷协议，并搜索一次课程代码。' };
    try {
      const db = await this.database();
      // DbList is also returned for expired sessions. A small read-only search
      // verifies that the school still accepts this student's saved session.
      await this.searchPage(db, [], 1, 1);
      return { connected: true, login_pending: false, downloads: this.downloads };
    }
    catch (e) {
      if (e.code !== 'LOGIN_REQUIRED') throw e;
      return { connected: false, login_pending: false, message: this.session.lastLoginError || e.message };
    }
  }

  login() {
    if (!this.session.pending) this.session.login().catch(() => {});
    return { login_pending: true, message: '请在新开的 MCP 专用 Chrome / Edge 窗口登录试卷库，由本人阅读确认使用协议，再搜索一次课程代码。完成后调用 paperbridge_status；不需要安装油猴或复制 Cookie。' };
  }

  async search(code, { page = 1, page_size = 50 } = {}) {
    code = courseCode(code);
    if (!Number.isInteger(page) || page < 1 || page > 100 || !Number.isInteger(page_size) || page_size < 1 || page_size > 100) throw new Error('检索分页参数超出范围。');
    const db = await this.database();
    const { rows, total } = await this.searchPage(db, [{ SearchField: 'paperCode', SearchContent: code }], page, page_size);
    const items = rows.map(paper).filter((p) => p.course_code.trim().toUpperCase().replace(/\s+/g, '') === code);
    return { course_code: code, total, page, items, next_page: page * page_size < total ? page + 1 : null,
      note: 'total 为学校检索命中数；items 仅保留课程代码完全匹配的试卷。有 next_page 时继续翻页。检索摘要可能没有考试类型，按正考/补考或学期选择前，用 paperbridge_details 读取详情，不能仅凭同名标题推断。' };
  }

  async searchPage(db, params, page, pageSize) {
    const payload = await this.json('/api/v1/Search/Search', {
      DbId: db.dbId, DbCode: db.dbCode, PageIndex: page, PageSize: pageSize,
      AdvancedSearchParams: params, CategoryExpression: '', CatalogCode: '',
    });
    const rows = payload?.result?.overviewResult;
    if (payload?.isSuccess !== true || !Array.isArray(rows)) throw new Error('试卷检索响应格式已变化，请更新工具。');
    const total = Number(payload.recordCount);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('试卷库未返回有效的结果总数。');
    return { rows, total };
  }

  async detail(recordId, db) {
    const query = new URLSearchParams({ ...db, recordId, userId: '' });
    const result = await this.json(`/api/v1/Detail?${query}`);
    const detail = result.detailResult;
    if (!detail?.isSuccess || detail.hasBrowserRight === false) throw new Error('当前账号没有此试卷的在线阅读权限。');
    const record = detail.result?.detailResult?.[0];
    if (!record || id(record.syS_FLD_SYSID) !== recordId) throw new Error('试卷详情不匹配，请重新检索。');
    return { info: paper(record), flag: id(record.flag ?? 0), query };
  }

  async details(recordIds) {
    if (!Array.isArray(recordIds) || !recordIds.length || recordIds.length > 20) throw new Error('每次请选择 1–20 份试卷。');
    recordIds = [...new Set(recordIds.map(id))];
    const db = await this.database(); const items = []; const failed = [];
    for (const recordId of recordIds) {
      try { items.push((await this.detail(recordId, db)).info); }
      catch (e) { failed.push({ record_id: recordId, error: e.message }); if (e.code === 'LOGIN_REQUIRED') break; }
    }
    return { items, failed, unprocessed: recordIds.slice(items.length + failed.length) };
  }

  async save(recordIds) {
    if (!Array.isArray(recordIds) || !recordIds.length || recordIds.length > 20) throw new Error('每次请选择 1–20 份试卷。');
    recordIds = [...new Set(recordIds.map(id))];
    const task = this.queue.then(async () => {
      const db = await this.database(); const saved = []; const failed = [];
      for (const recordId of recordIds) {
        try { saved.push(await this.saveOne(recordId, db)); }
        catch (e) { failed.push({ record_id: recordId, error: e.message }); if (e.code === 'LOGIN_REQUIRED') break; }
      }
      return { saved, failed, processed: saved.length + failed.length, requested: recordIds.length,
        unprocessed: recordIds.slice(saved.length + failed.length) };
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async saveOne(recordId, db) {
    const { query, info, flag } = await this.detail(recordId, db);
    // flag=0 is a valid reader flag; use the same BrowserUrl flow as View Online.
    const urls = await this.json(`/api/v1/file/BrowserUrl/${flag}?${query}`);
    if (!Array.isArray(urls) || typeof urls[0] !== 'string' || !urls[0]) throw new Error('学校没有提供可阅读的 PDF。');
    const reader = new URL(urls[0], this.base);
    let value = reader.href;
    if (reader.origin !== this.base || reader.username || reader.password) throw new Error('试卷库返回了非允许的资源地址。');
    if (reader.pathname === '/static/readonline/web/viewer.html') value = reader.searchParams.get('file');
    const fileUrl = examUrl(value, this.base);
    if (fileUrl.pathname.toLowerCase() !== '/api/v1/file/browserfile' || fileUrl.searchParams.get('recordId') !== recordId
      || fileUrl.searchParams.get('dbCode') !== db.dbCode || fileUrl.searchParams.get('dbId') !== db.dbId) throw new Error('PDF 地址与选中的试卷不匹配。');
    const { buffer } = await this.request(fileUrl.href);
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')) || !buffer.subarray(-4096).includes(Buffer.from('%%EOF'))) {
      throw new Error('学校没有返回完整 PDF（可能登录过期或无阅读权限），未保存文件。');
    }
    const code = courseCode(info.course_code);
    const directory = path.join(this.downloads, code);
    const name = `${code}_${safeName(info.year).slice(0, 12)}_${safeName(info.title).slice(0, 50)}_${recordId}.pdf`;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    let file = path.join(directory, name); let duplicate = false;
    for (let counter = 0; ; counter++) {
      if (counter) file = path.join(directory, `${path.parse(name).name}-${sha256.slice(0, 10)}${counter > 1 ? `-${counter}` : ''}.pdf`);
      try { fs.writeFileSync(file, buffer, { mode: 0o600, flag: 'wx' }); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw new Error('无法保存试卷，请检查本地目录权限。');
        const stat = fs.lstatSync(file);
        if (stat.isFile() && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === sha256) { duplicate = true; break; }
        if (counter > 100) throw new Error('同名文件过多，请检查试卷目录。');
      }
    }
    return { ...info, path: file, size: buffer.length, sha256, duplicate };
  }
}
