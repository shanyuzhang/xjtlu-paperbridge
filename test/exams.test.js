import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ExamClient, courseCode, examUrl } from '../src/client.js';
import { ExamSession, stateToken } from '../src/session.js';
import { registerExamTools, invokeExamTool } from '../src/tools.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xjtlu-exams-'));
const records = [
  { syS_FLD_SYSID: '101', paperCode: '<em>MTH129</em>', paperTitle: 'Final ../ paper', year: '2024-2025', flag: 0, typeABB: 'F', semsterABB: 'S1' },
  { syS_FLD_SYSID: '102', paperCode: 'MTH129', paperTitle: 'Resit paper', year: '2024-2025', flag: 0 },
  { syS_FLD_SYSID: '103', paperCode: 'MTH129TC', paperTitle: 'Another module', year: '2024-2025', flag: 0 },
];
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer <<>>\n%%EOF\n');
let base; let server; const requests = [];
before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base); let text = ''; for await (const c of req) text += c;
    requests.push({ path: url.pathname, method: req.method, data: text ? JSON.parse(text) : null, auth: req.headers.authorization });
    if (req.headers.authorization !== 'bearer fixture-token' || req.headers.cookie !== 'ETD=fixture-cookie') { res.writeHead(401); res.end(); return; }
    const json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (url.pathname === '/api/v1/Search/DbList') return json([{ databasecode: 'EXAMXJTLU', sysid: 3 }]);
    if (url.pathname === '/api/v1/Search/Search') return json({ isSuccess: true, recordCount: 3, result: { overviewResult: JSON.parse(text).PageIndex === 1 ? records.slice(0, 2) : records.slice(2) } });
    if (url.pathname === '/api/v1/Detail') return json({ detailResult: { isSuccess: true, hasBrowserRight: url.searchParams.get('recordId') !== '102', result: { detailResult: records.filter((r) => r.syS_FLD_SYSID === url.searchParams.get('recordId')) } } });
    if (url.pathname === '/api/v1/file/BrowserUrl/0') return json([`/api/v1/File/BrowserFile?${url.searchParams}&timestamp=1&signature=fixture-signature`]);
    if (url.pathname === '/api/v1/File/BrowserFile') { res.setHeader('Content-Type', 'application/pdf'); res.end(pdf); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(home, { recursive: true, force: true }); });
const make = (options = {}) => new ExamClient({ base, downloads: path.join(home, 'papers'), session: { token: () => 'fixture-token', cookieHeader: () => 'ETD=fixture-cookie' }, ...options });

test('search preserves titles, filters exact module codes, and exposes pagination without credentials', async () => {
  const result = await make().search('mth 129', { page_size: 2 });
  assert.equal(result.items.length, 2); assert.equal(result.next_page, 2); assert.equal(result.items[0].course_code, 'MTH129');
  assert.equal((await make().search('MTH129', { page: 2, page_size: 2 })).items.length, 0);
  const request = requests.find((r) => r.path === '/api/v1/Search/Search');
  assert.equal(request.method, 'POST'); assert.deepEqual(request.data.AdvancedSearchParams, [{ SearchField: 'paperCode', SearchContent: 'MTH129' }]);
  assert.doesNotMatch(JSON.stringify(result), /fixture-(token|cookie|signature)/);
  assert.throws(() => courseCode('../MTH129'), /课程代码/);
});

test('flag zero reader PDFs save privately, deduplicate, and never contain signed URLs in the result', async () => {
  const client = make(); const first = await client.save(['101']); const saved = first.saved[0];
  assert.equal(first.failed.length, 0); assert.equal(saved.size, pdf.length); assert.ok(saved.path.startsWith(path.join(home, 'papers', 'MTH129') + path.sep));
  assert.deepEqual(fs.readFileSync(saved.path), pdf);
  assert.equal((await client.save(['101'])).saved[0].duplicate, true);
  assert.equal(fs.readdirSync(path.dirname(saved.path)).length, 1);
  assert.doesNotMatch(JSON.stringify(first), /fixture-(token|cookie|signature)|BrowserFile/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
});

test('explicit denied reader rights are not followed by a file request', async () => {
  const before = requests.length; const result = await make().save(['102']);
  assert.equal(result.saved.length, 0); assert.match(result.failed[0].error, /阅读权限/);
  assert.ok(!requests.slice(before).some((r) => /BrowserUrl|BrowserFile/.test(r.path)));
});

test('details distinguish exam type and semester using school metadata', async () => {
  const result = await make().details(['101', '102']);
  assert.equal(result.items[0].exam_type, 'Final'); assert.equal(result.items[0].semester, 'S1');
  assert.equal(result.failed.length, 1); assert.doesNotMatch(JSON.stringify(result), /fixture-token|fixture-signature/);
});

test('file bodies, resource paths and cross-origin redirects fail closed', async () => {
  for (const value of ['https://evil.example/api/v1/File/BrowserFile', '/api/v1/User/Delete', '/api/v1/File/BrowserFile#fragment']) assert.throws(() => examUrl(value, base), /非允许/);
  const calls = [];
  const redirect = make({ fetchImpl: async (url) => { calls.push(String(url)); return new Response('', { status: 302, headers: { Location: 'https://evil.example/' } }); } });
  assert.equal((await redirect.status()).connected, false); assert.equal(calls.length, 1);
  const client = make({ fetchImpl: async (url, options) => String(url).includes('/File/BrowserFile')
    ? new Response('<html>login expired</html>', { headers: { 'Content-Type': 'application/pdf' } }) : fetch(url, options) });
  const result = await client.save(['101']); assert.equal(result.saved.length, 0); assert.match(result.failed[0].error, /未保存/);
  const oversized = make({ fetchImpl: async () => new Response('x', { headers: { 'Content-Length': String(61 * 1024 * 1024) } }) });
  await assert.rejects(oversized.database(), /60 MB/);
});

test('changed content does not overwrite an existing same-name PDF', async () => {
  const original = (await make().save(['101'])).saved[0];
  const changed = Buffer.from('%PDF-1.4\nchanged\n%%EOF');
  const client = make({ fetchImpl: async (url, options) => String(url).includes('/File/BrowserFile') ? new Response(changed) : fetch(url, options) });
  const next = (await client.save(['101'])).saved[0];
  assert.notEqual(next.path, original.path); assert.deepEqual(fs.readFileSync(original.path), pdf);
});

test('a missing session never starts a browser or network request; tool input is strict', async () => {
  let fetched = false;
  const client = make({ session: { token: () => null, cookieHeader: () => '', login: () => { throw new Error('must not launch'); } }, fetchImpl: () => { fetched = true; } });
  assert.equal((await client.status()).connected, false); assert.equal(fetched, false);
  await assert.rejects(invokeExamTool(client, 'paperbridge_download', { record_ids: ['../101'] }));
  await assert.rejects(invokeExamTool(client, 'paperbridge_search', { course_code: 'MTH129', url: 'https://evil.example' }));
});

test('public database metadata cannot make an expired session appear connected', async () => {
  const calls = [];
  const client = make({ fetchImpl: async (url, options) => {
    calls.push({ path: new URL(url).pathname, data: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/Search/Search')) return Response.json(null);
    return Response.json([{ databasecode: 'EXAMXJTLU', sysid: 3 }]);
  } });
  const status = await client.status();
  assert.equal(status.connected, false); assert.match(status.message, /登录/);
  assert.equal(calls[1].data.PageSize, 1); assert.deepEqual(calls[1].data.AdvancedSearchParams, []);
  await assert.rejects(client.search('FIN104'), (e) => e.code === 'LOGIN_REQUIRED');
});

test('an authenticated empty search is valid but a changed response remains a format error', async () => {
  const client = make({ fetchImpl: async (url) => Response.json(String(url).includes('/Search/DbList')
    ? [{ databasecode: 'EXAMXJTLU', sysid: 3 }] : { isSuccess: true, recordCount: 0, result: { overviewResult: [] } }) });
  assert.equal((await client.status()).connected, true);
  assert.equal((await client.search('FIN104')).items.length, 0);
  client.fetch = async (url) => Response.json(String(url).includes('/Search/DbList')
    ? [{ databasecode: 'EXAMXJTLU', sysid: 3 }] : { isSuccess: true, result: {} });
  await assert.rejects(client.status(), /响应格式/);
});

test('exam login uses a separate ordinary profile and saves only scoped cookies and the ETD token', async () => {
  const dataDir = path.join(home, 'login'); const profile = path.join(dataDir, 'login-browser'); const netlog = path.join(profile, 'login-netlog.json');
  const state = { cookies: [{ domain: '127.0.0.1', name: 'ETD', value: 'fixture-cookie', path: '/', expires: -1 }, { domain: 'uim.xjtlu.edu.cn', name: 'SSO', value: 'never-save' }],
    origins: [{ origin: base, localStorage: [{ name: 'token', value: 'fixture-token' }, { name: 'password', value: 'never-save' }] }, { origin: 'https://evil.example', localStorage: [{ name: 'token', value: 'never-save' }] }] };
  const proc = new EventEmitter(); proc.exitCode = null; proc.signalCode = null; let args; let guarded = false;
  proc.kill = () => { proc.exitCode = 0; setImmediate(() => proc.emit('exit', 0)); };
  const context = { route: async () => { guarded = true; }, storageState: async () => state, close: async () => {}, pages: () => [page] };
  const page = { goto: async () => { assert.equal(guarded, true); }, context: () => context, waitForFunction: async () => {} };
  const session = new ExamSession({ base, dataDir, pollMs: 5, findBrowser: (c) => c === 'chrome' ? '/fake/chrome' : null,
    spawnBrowser: (exe, value) => {
      args = value;
      fs.writeFileSync(netlog, '{"constants":{"logEventTypes":{"URL_REQUEST_START_JOB":1,"HTTP_TRANSACTION_READ_RESPONSE_HEADERS":2}},\n');
      setTimeout(() => fs.appendFileSync(netlog, JSON.stringify({ type: 1, source: { id: 1 }, params: { url: base + '/api/v1/Search/Search' } }) + ',\n'
        + JSON.stringify({ type: 2, source: { id: 1 }, params: { headers: ['HTTP/1.1 200'] } }) + ',\n'), 10);
      return proc;
    }, launchBrowser: async () => context });
  await session.login();
  assert.ok(args.includes(`--user-data-dir=${profile}`)); assert.ok(!args.some((a) => /enable-automation|remote-debugging/.test(a)));
  const saved = fs.readFileSync(path.join(dataDir, 'session.json'), 'utf8'); assert.doesNotMatch(saved, /never-save|password|uim\.xjtlu/);
  assert.equal(stateToken(JSON.parse(saved), base), 'fixture-token'); assert.equal(fs.existsSync(netlog), false);
  await assert.rejects(session.login({ headless: true }), /试卷库/);
});

test('real MCP transport lists exam tools and returns search/details/download results', async () => {
  const server = new McpServer({ name: 'exam-test', version: '1' }); registerExamTools(server, make());
  const client = new Client({ name: 'student', version: '1' }); const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const { tools } = await client.listTools(); assert.equal(tools.length, 5);
    assert.equal(tools.find((t) => t.name === 'paperbridge_download').annotations.readOnlyHint, false);
    assert.equal(tools.find((t) => t.name === 'paperbridge_search').annotations.readOnlyHint, true);
    const search = await client.callTool({ name: 'paperbridge_search', arguments: { course_code: 'MTH129' } });
    assert.equal(JSON.parse(search.content[0].text).items[0].record_id, '101');
    const details = await client.callTool({ name: 'paperbridge_details', arguments: { record_ids: ['101'] } });
    assert.equal(JSON.parse(details.content[0].text).items[0].exam_type, 'Final');
    const download = await client.callTool({ name: 'paperbridge_download', arguments: { record_ids: ['101'] } });
    assert.equal(JSON.parse(download.content[0].text).saved.length, 1);
  } finally { await client.close(); await server.close(); }
});
