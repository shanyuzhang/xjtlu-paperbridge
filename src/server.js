import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExamClient } from './client.js';
import { registerExamTools } from './tools.js';

const { version } = createRequire(import.meta.url)('../package.json');

export async function startServer() {
  const server = new McpServer({ name: 'paperbridge', version }, {
    instructions: 'PaperBridge 仅用于本人有权访问的历年试卷。先用 paperbridge_status 检查会话；未连接则用 paperbridge_login，让本人在专用窗口登录、确认协议并搜索一次，再检查状态。按课程代码用 paperbridge_search 检索，处理 next_page。按学期、正考或补考选择前必须调用 paperbridge_details，同名标题不能用来判断考试类型。只下载检索得到的 record_id，用 paperbridge_download 保存本地 PDF；不输出会话凭据、签名链接或试卷正文。',
  });
  registerExamTools(server, new ExamClient());
  await server.connect(new StdioServerTransport());
  return server;
}
