#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, configure, settings } from '../src/config.js';
import { ExamClient } from '../src/client.js';
import { installTarget, launchConfig, stableInstall, targets } from '../src/setup.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  clients: { type: 'string' }, downloads: { type: 'string' }, yes: { type: 'boolean' },
  'no-login': { type: 'boolean' }, 'no-install': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} });
const command = values.help ? 'help' : positionals[0] || 'serve';
const log = (text) => process.stderr.write(text + '\n');
const print = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

try {
  if (command === 'help') log(`PaperBridge · 个人历年试卷工具\n\n  setup       安装到独立目录并接入 AI 客户端\n  login       本人登录试卷库、确认协议并搜索一次\n  status      检查独立会话\n  search CODE 按课程代码检索，例如 FIN104\n  details ID  查看记录详情（可传多个 ID）\n  download ID 保存选定记录 PDF（ID 来自检索）\n  config      输出手动 MCP 配置\n  serve       stdio MCP（默认）\n\nsetup 默认自动接入检测到的 Codex / Harness，修改前备份，无需确认\n可选 --clients codex,deepseek-harness --no-login；--yes 保留兼容\ndownload 默认保存到当前命令运行目录；--downloads <目录> 仅更改本次下载\nsetup --downloads <目录> 设置命令行默认目录；AI 每次下载使用当前项目或用户指定目录\n数据目录：${DATA_DIR}`);
  else if (command === 'setup') {
    const clients = values.clients || 'codex,deepseek-harness';
    const chosen = clients !== 'all' ? clients.split(',').map((s) => s.trim()) : null;
    const found = targets().filter((target) => !chosen || chosen.includes(target.id));
    if (!found.length) throw new Error('未检测到选定客户端。请先打开一次 Codex / DeepSeek Harness，或用 config 命令手动接入。');
    if (values.downloads) configure({ downloads: path.resolve(values.downloads) });
    log('AI 下载会保存到当前对话的项目文件夹，也可以直接告诉 AI 其他保存位置。');
    if (values.downloads) log(`命令行默认保存目录：${settings().downloads}`);
    const launch = values['no-install'] ? launchConfig() : stableInstall(log);
    const connected = [];
    for (const target of found) {
      const result = installTarget(target, launch);
      connected.push(target.name);
      log(`✓ ${target.name}: ${result.file}${result.backup ? `\n  备份：${result.backup}` : ''}`);
    }
    if (!connected.length) log('没有修改任何客户端。');
    else {
      if (!values['no-login']) await new ExamClient().session.login({ onProgress: log });
      log(`完成。完全退出并重开 ${connected.join('、')}，然后问：「帮我找 FIN104 的历年试卷」。${values['no-login'] ? '首次使用需本人登录试卷库。' : ''}`);
    }
  } else {
    if (values.downloads && command !== 'download') configure({ downloads: path.resolve(values.downloads) });
    if (command === 'serve') await (await import('../src/server.js')).startServer();
    else if (command === 'config') print({ mcpServers: { paperbridge: launchConfig() } });
    else {
      const client = new ExamClient();
      if (command === 'login') {
        log('请在专用窗口由本人登录，进入 Past Exam Papers，阅读确认协议，再搜索一次课程代码。保存会话后窗口自动关闭。');
        await client.session.login({ onProgress: log });
      } else if (command === 'status') print(await client.status());
      else if (command === 'search') {
        if (!positionals[1]) throw new Error('请提供课程代码，例如 search FIN104。');
        print(await client.search(positionals[1]));
      } else if (command === 'details' || command === 'download') {
        const ids = positionals.slice(1);
        print(command === 'details' ? await client.details(ids) : await client.save(ids, { downloadDir: values.downloads ? path.resolve(values.downloads) : settings().downloads }));
      } else throw new Error('未知命令，请运行 paperbridge --help。');
    }
  }
} catch (e) { log(`✗ ${e.message}`); process.exitCode = 1; }
