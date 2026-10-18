import path from 'node:path';
import { z } from 'zod';

export const EXAM_TOOLS = [
  { name: 'paperbridge_status', description: '检查西浦图书馆历年试卷库独立登录状态和登录进度。PaperBridge 使用独立的本人会话。', input: {}, run: (c) => c.status() },
  { name: 'paperbridge_login', localWrite: true, description: '为本人打开试卷库专用登录窗口。本人完成学校 SSO、阅读并确认试卷使用协议，再搜索一次课程代码。立即返回，随后用 paperbridge_status 检查；不代填密码、不自动同意协议。', input: {}, run: (c) => c.login() },
  { name: 'paperbridge_search', description: '按课程代码检索本人有权访问的西浦历年试卷，返回标题、学年和 record_id。有 next_page 时继续翻页，不猜测试卷 ID。按正考/补考或学期选择前调用 paperbridge_details，不能只看同名标题。未登录先调用 paperbridge_login。',
    input: { course_code: z.string().min(3).max(20), page: z.number().int().min(1).max(100).optional(), page_size: z.number().int().min(1).max(100).optional() }, run: (c, a) => c.search(a.course_code, a) },
  { name: 'paperbridge_details', description: '读取检索得到的试卷详情，返回学年、学期和考试类型（Final 正考 / Resit 补考），一次最多 20 份。用于区分同年同名的试卷，不读取题目正文。',
    input: { record_ids: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(20) }, run: (c, a) => c.details(a.record_ids) },
  { name: 'paperbridge_download', localWrite: true, description: '将选定试卷 PDF 保存到 download_dir/<课程代码>/。download_dir 必填，使用用户明确指定的文件夹，否则使用本次对话当前打开的项目文件夹的绝对路径；不知道当前项目路径时先询问用户保存到哪里，不猜测 Documents、主目录或 MCP 程序目录。record_ids 必须来自 paperbridge_search，一次最多 20 份。下载后向用户显示 saved 中的实际文件路径；不返回 Cookie、token 或临时签名链接。',
    input: { record_ids: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(20), download_dir: z.string().min(1).refine((value) => path.isAbsolute(value) && !value.includes('\0'), '请提供保存目录的绝对路径。').describe('本次下载的绝对保存目录。优先用户指定目录，其次当前对话的项目文件夹；无法确定时先询问用户。') }, run: (c, a) => c.save(a.record_ids, { downloadDir: a.download_dir }) },
];

export async function invokeExamTool(client, name, args = {}) {
  const tool = EXAM_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error('未知试卷工具。');
  return tool.run(client, z.object(tool.input).strict().parse(args));
}

export function registerExamTools(server, client) {
  for (const tool of EXAM_TOOLS) server.registerTool(tool.name, {
    description: tool.description, inputSchema: tool.input,
    annotations: { readOnlyHint: !tool.localWrite, destructiveHint: false, openWorldHint: true },
  }, async (args) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await invokeExamTool(client, tool.name, args), null, 1) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: e.name === 'ZodError'
      ? tool.name === 'paperbridge_download' ? '试卷参数不正确。下载时必须提供 download_dir：用户指定目录或当前项目文件夹的绝对路径；不确定时先询问用户。' : '试卷参数不正确。'
      : e.message }] }; }
  });
}
