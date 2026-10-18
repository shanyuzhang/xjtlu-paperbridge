# PaperBridge

供个人使用的西浦历年试卷检索与 PDF 保存工具，通过本地 MCP 接入 Codex、DeepSeek Harness。每位使用者使用自己的学校账号登录，文件保存在自己的电脑。

这是独立的非官方项目，只有试卷功能。无需油猴或 Computer Use。项目不提供共享账号、预置登录信息或试卷合集。

## 安装

先安装并打开一次 Codex 或 DeepSeek Harness，并准备 Chrome 或 Edge。下面的一键脚本会自动处理 Node.js，无需提前安装 Node、Git 或 Python。

**macOS / Linux**，打开终端，粘贴：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/shanyuzhang/xjtlu-paperbridge/main/install.sh)"
```

**Windows**，打开 PowerShell，粘贴：

```powershell
irm https://raw.githubusercontent.com/shanyuzhang/xjtlu-paperbridge/main/install.ps1 | iex
```

脚本会检测 Node.js 20+；缺少时下载 Node 24 LTS，使用固定的官方 SHA-256 校验，安装到 `~/.paperbridge/node`，不改系统 Node 或系统 PATH，也不需要管理员权限。随后安装 PaperBridge，自动接入检测到的 Codex / Harness，并打开学校登录窗口。

由本人登录、进入 Past Exam Papers、确认协议并搜索一次课程代码后，窗口会自动关闭。完全退出并重新打开 AI 客户端，就可以问「帮我找 FIN104 的历年试卷」。重新运行相同命令即可更新。

Windows 发布脚本采用 ASCII 包装，避免 PowerShell 5.1 解码中文乱码；[可读源码](scripts/bootstrap/install.ps1) 与 [macOS / Linux 脚本](install.sh) 均在仓库中。没有浏览器或 AI 客户端时会提示先安装，不会自动创建账号或接受学校协议。

### 已有 Node.js 的安装方式

如果已经有 Node.js 20+，也可以直接使用 npm：

```bash
npx -y xjtlu-paperbridge@latest setup
```

如果让 AI 代为安装，使用下面这一行，只接入检测到的 Codex / Harness。安装后重启客户端，再由本人完成试卷库登录：

```bash
npx -y xjtlu-paperbridge@latest setup --yes --clients codex,deepseek-harness --no-login
```

安装器将程序放到 `~/.paperbridge/app`，修改前备份客户端配置，保留其他 MCP 服务。npm 包只含程序和说明，不包含会话或试卷。升级时重新运行同一行命令，再重启 AI 客户端即可。

AI 在没有 Node 的电脑上代装时，可在运行脚本前设置 `PAPERBRIDGE_NO_LOGIN=1`，先完成安装和配置；后续通过 AI 的登录工具由本人连接试卷库。脚本不会要求在终端输入学校密码。

可用 `PAPERBRIDGE_CLIENTS=codex` 或 `PAPERBRIDGE_CLIENTS=deepseek-harness` 只连接其中一个；默认连接检测到的两者。

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

使用一键脚本安装后，可直接让 AI 调用 `paperbridge_login`。已有系统 Node / npx 时也可以运行：

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

直接对 AI 说「下载 FIN104 的试卷到当前文件夹」，会保存到本次对话打开的项目下，例如 `你的项目/FIN104/试卷.pdf`。也可以说「保存到桌面的期末复习文件夹」。AI 不知道当前项目路径时，会先询问保存位置；下载完成后会给出实际文件路径。

下载工具必须传入绝对路径 `download_dir`，不会再自动回退到 Documents。切换项目时，每次使用当前对话的项目目录；安装 PaperBridge 的位置不影响保存位置。升级后需完全退出并重新打开 AI 客户端，以刷新工具参数。

| 工具 | 用途 |
| --- | --- |
| `paperbridge_status` | 检查本人会话及登录进度 |
| `paperbridge_login` | 打开本人专用登录窗口，立即返回 |
| `paperbridge_search` | 按 `course_code` 检索，返回记录 ID 和 `next_page` |
| `paperbridge_details` | 按 `record_ids` 读取学年、学期、正考 / 补考类型 |
| `paperbridge_download` | 按 `record_ids` 保存到 `download_dir/<课程代码>/`，一次最多 20 份 |

有下一页时继续检索。相同标题可能对应正考和补考，选择前应读取详情。下载只处理当前账号有阅读权限的学校 PDF，检查文件头和结束标记，限制 60 MB；相同内容去重，不覆盖同名不同内容。工具只返回元数据和本地路径，不返回试卷正文或临时签名 URL。

保存 PDF 属于本地写盘操作。客户端请求审批时允许该次下载即可；禁止审批的只读模式可能拒绝保存。

## 本地文件与配置

- 会话和配置：`~/.paperbridge/`，含 `session.json`、`login-browser/` 和 `config.json`。
- AI 下载：本次对话的项目目录，或用户指定目录，其下按课程代码归档。
- 命令行下载：默认当前命令运行目录；已有自选目录配置或 `PAPERBRIDGE_DOWNLOADS` 时使用该默认值。`download --downloads <目录>` 只指定本次保存位置，不更改后续下载。
- `setup --downloads <目录>` 设置命令行默认目录；AI 下载始终以本次传入的 `download_dir` 为准。
- `PAPERBRIDGE_HOME` 覆盖数据目录。
- `PAPERBRIDGE_BROWSER` 可指定 `chrome`、`msedge` 或 `chromium`。默认查找系统 Chrome / Edge。

学校会话属于敏感信息。仓库不包含本人会话、浏览器配置、PDF、`.env` 或任何真实凭据；安装后也不自动读取其他程序的会话。每位使用者须自行确认学校条款及资料使用范围，不要公开转发下载的试卷。

命令行示例，先检索取得 ID，再下载（将 `<记录ID>` 替换为检索结果）：

```bash
npx -y xjtlu-paperbridge@latest download <记录ID>
npx -y xjtlu-paperbridge@latest download <记录ID> --downloads "/absolute/path/期末复习"
```

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

0.1.1 增加一键安装脚本，自动测试共 21 项。macOS 已实际验证从没有系统 Node 的环境下载、校验并使用独立 Node，带空格的安装路径也能启动 5 个 MCP 工具。Windows 脚本已检查 UTF-8 包装与固定校验值，尚未在 Windows 真机验证。

0.1.2 支持按当前项目或自选文件夹下载，MCP 下载必须提供绝对保存路径，命令行默认当前目录。24 项自动测试通过，覆盖中文和空格目录、不同目标的并发下载、缺少目录时拒绝请求，以及单次路径设置不修改默认配置。本次真实 Codex 验证在学校会话过期处停止，未重新进行真实试卷下载。

MIT 许可，保留复用代码的作者信息，见 [LICENSE](LICENSE)。
