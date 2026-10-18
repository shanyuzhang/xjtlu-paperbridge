import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExamClient } from './client.js';
import { registerExamTools } from './tools.js';

const { version } = createRequire(import.meta.url)('../package.json');

export async function startServer() {
  const server = new McpServer({ name: 'paperbridge', version }, {
    instructions: 'PaperBridge 仅用于本人有权访问的历年试卷。先用 paperbridge_status 检查会话；未连接则用 paperbridge_login，让本人在专用窗口登录、确认协议并搜索一次，再检查状态。按课程代码用 paperbridge_search 检索，处理 next_page。按学期、正考或补考选择前必须调用 paperbridge_details，同名标题不能用来判断考试类型。只下载检索得到的 record_id。调用 paperbridge_download 时，download_dir 必须传用户指定目录或本次对话当前项目文件夹的绝对路径；无法确定当前文件夹时先询问用户，不使用 MCP 进程工作目录或 status 返回的备用目录猜测。完成后显示实际文件路径。不输出会话凭据、签名链接或试卷正文。',
  });
  registerExamTools(server, new ExamClient());
  await server.connect(new StdioServerTransport());
  return server;
}
