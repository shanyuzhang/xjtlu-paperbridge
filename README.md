# PaperBridge

供个人使用的西浦历年试卷检索与 PDF 保存工具，通过本地 MCP 接入 Codex、DeepSeek Harness。每位使用者使用自己的学校账号登录，文件保存在自己的电脑。

这是独立的非官方项目，只有试卷功能。无需油猴或 Computer Use。项目不提供共享账号、预置登录信息或试卷合集。

## 安装

需要 Node.js 20+、Chrome 或 Edge，以及能运行本地 stdio MCP 的 AI 客户端。先安装并打开一次 Codex 或 DeepSeek Harness。

在终端粘贴这一行，按提示选择要连接的客户端，并在弹出的窗口完成学校登录：

```bash
npx -y xjtlu-paperbridge@latest setup
```

如果让 AI 代为安装，使用下面这一行，只接入检测到的 Codex / Harness。安装后重启客户端，再由本人完成试卷库登录：

```bash
npx -y xjtlu-paperbridge@latest setup --yes --clients codex,deepseek-harness --no-login
```

安装器将程序放到 `~/.paperbridge/app`，修改前备份客户端配置，保留其他 MCP 服务。npm 包只含程序和说明，不包含会话或试卷。升级时重新运行同一行命令，再重启 AI 客户端即可。

也可以从 GitHub 安装源码：

```bash
git clone https://github.com/shanyuzhang/xjtlu-paperbridge.git
cd xjtlu-paperbridge
npm ci --ignore-scripts
node bin/paperbridge.js setup --yes --clients codex,deepseek-harness --no-login
```

完全退出并重开 AI 客户端，问「帮我找 FIN104 的历年试卷，区分正考和补考，下载我选的那份」。首次使用，工具会提示本人登录。

升级时，在仓库目录运行 `git pull --ff-only`、`npm ci --ignore-scripts`，再运行相同的 setup 命令，最后重启 AI 客户端。

## 本人登录

安装后也可以直接运行：

```bash
npx -y xjtlu-paperbridge@latest login
npx -y xjtlu-paperbridge@latest status
```

源码目录内使用：

```bash
node bin/paperbridge.js login
node bin/paperbridge.js status
```

在专用普通 Chrome / Edge 窗口完成学校登录，点击 **Past Exam Papers**，由本人阅读确认试卷使用协议，再搜索一次课程代码。会话保存后窗口自动关闭。AI 也能用 `paperbridge_login` 打开窗口，再检查 `paperbridge_status`。

日常浏览器和其他程序的登录不会自动同步到 PaperBridge。会话过期时重新登录；不需要向 AI 发送密码、Cookie 或 token，也不要分享本机数据目录。学校网络不可达时检查自己的校园网络或 VPN。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `paperbridge_status` | 检查本人会话及登录进度 |
| `paperbridge_login` | 打开本人专用登录窗口，立即返回 |
| `paperbridge_search` | 按 `course_code` 检索，返回记录 ID 和 `next_page` |
| `paperbridge_details` | 按 `record_ids` 读取学年、学期、正考 / 补考类型 |
| `paperbridge_download` | 按检索记录 ID 保存 PDF，一次最多 20 份 |

有下一页时继续检索。相同标题可能对应正考和补考，选择前应读取详情。下载只处理当前账号有阅读权限的学校 PDF，检查文件头和结束标记，限制 60 MB；相同内容去重，不覆盖同名不同内容。工具只返回元数据和本地路径，不返回试卷正文或临时签名 URL。

保存 PDF 属于本地写盘操作。客户端请求审批时允许该次下载即可；禁止审批的只读模式可能拒绝保存。

## 本地文件与配置

- 会话和配置：`~/.paperbridge/`，含 `session.json`、`login-browser/` 和 `config.json`。
- 默认 PDF：`~/Documents/PaperBridge/<课程代码>/`。
- `PAPERBRIDGE_HOME` 覆盖数据目录；`PAPERBRIDGE_DOWNLOADS` 或 `--downloads <目录>` 覆盖下载目录。
- `PAPERBRIDGE_BROWSER` 可指定 `chrome`、`msedge` 或 `chromium`。默认查找系统 Chrome / Edge。

学校会话属于敏感信息。仓库不包含本人会话、浏览器配置、PDF、`.env` 或任何真实凭据；安装后也不自动读取其他程序的会话。每位使用者须自行确认学校条款及资料使用范围，不要公开转发下载的试卷。

## 手动接入

运行 `node bin/paperbridge.js config` 获取这台电脑的准确 JSON。Codex 使用：

```toml
[mcp_servers.paperbridge]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/bin/paperbridge.js", "serve"]
```

DeepSeek Harness 使用 `DSH_HOME/cordis.patch.yml`，未设置 DSH_HOME 时为 `~/.dsh/cordis.patch.yml`。将以下 patch 合并到已有列表，路径换成本机绝对路径；需使用包含官方 MCP 客户端插件的新版 Harness。

```yaml
- insert:
    - id: mcp-paperbridge
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: paperbridge
        transport: stdio
        command: /absolute/path/to/node
        args: [/absolute/path/to/bin/paperbridge.js, serve]
```

## 验证与开发

```bash
npm test
node scripts/verify-live.mjs --course-code FIN104
```

自动测试使用本地假学校接口及真实 MCP transport，验证检索、权限拒绝、PDF 保存、去重、独立登录和配置合并。真实验证命令需要本人登录，并会保存一份选定试卷及检查 PDF 页数。它不打印会话或题目正文。

2026-10-18，PaperBridge 0.1.0 在 macOS 上通过 17 项自动测试；Codex CLI 和 DeepSeek Harness 均通过独立的 `paperbridge_*` 工具完成 FIN104 检索（6 条）、详情及 PDF 下载。独立解析确认所选试卷为 426316 字节、6 页。Windows / Linux 尚未真机验证。协议或学校接口变化后可能需要更新；保存的会话过期时，状态检查会要求本人重新登录。

MIT 许可，保留复用代码的作者信息，见 [LICENSE](LICENSE)。
