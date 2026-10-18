#!/bin/bash
# PaperBridge bootstrap for macOS / Linux. No sudo or system-wide Node changes.
set -euo pipefail
umask 077

NODE_VERSION="v24.22.0"
PAPERBRIDGE_DATA="${PAPERBRIDGE_HOME:-$HOME/.paperbridge}"
case "$PAPERBRIDGE_DATA" in /*) ;; *) PAPERBRIDGE_DATA="$PWD/$PAPERBRIDGE_DATA" ;; esac
say() { printf '%s\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
fetch() { curl --proto '=https' --proto-redir '=https' -fLsS --connect-timeout 10 --speed-limit 20480 --speed-time 20 --retry 1 -o "$2" "$1"; }
node_ok() {
  [ -x "$1" ] || return 1
  local major
  major="$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge 20 ]
}
checksum() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else fail '系统缺少 SHA-256 校验工具。'; fi
}

say 'PaperBridge · 一键安装'
case "$(uname -s)" in Darwin) PB_OS=darwin ;; Linux) PB_OS=linux ;; *) fail '此脚本适用于 macOS / Linux；Windows 请使用 PowerShell 命令。' ;; esac
case "$(uname -m)" in arm64|aarch64) PB_ARCH=arm64 ;; x86_64|amd64) PB_ARCH=x64 ;; *) fail '暂不支持这种处理器。' ;; esac
if [ "$PB_OS" = darwin ]; then
  browser_found=""
  for app in /Applications/Google\ Chrome.app "$HOME/Applications/Google Chrome.app" /Applications/Microsoft\ Edge.app "$HOME/Applications/Microsoft Edge.app"; do
    [ ! -d "$app" ] || browser_found=1
  done
  [ -n "$browser_found" ] || fail '请先安装 Chrome 或 Edge，再重新运行同一行命令。Chrome：https://www.google.com/chrome/'
fi

PAPERBRIDGE_TMP="$(mktemp -d)"
trap 'rm -rf "$PAPERBRIDGE_TMP"' EXIT
NODE_EXECUTABLE=""
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE_EXECUTABLE="$(command -v node)"
elif node_ok "$PAPERBRIDGE_DATA/node/bin/node" && [ -x "$PAPERBRIDGE_DATA/node/bin/npm" ]; then
  NODE_EXECUTABLE="$PAPERBRIDGE_DATA/node/bin/node"
else
  case "$PB_OS-$PB_ARCH" in
    darwin-arm64) EXPECTED_SHA='6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5' ;;
    darwin-x64) EXPECTED_SHA='495e3f273c645f3c4677d438304cdfc701729ea5dec5728f5c8e76a2dece4b91' ;;
    linux-arm64) EXPECTED_SHA='b7e7991d5407815adfa74a2a9cd4db683552c8ce32ff4a295c22e972849c3f5d' ;;
    linux-x64) EXPECTED_SHA='28ea0a438de9a13bd7891fd758eee6c7819ee8af5442dfd8d45bd65e56d4228c' ;;
  esac
  NODE_ARCHIVE="node-$NODE_VERSION-$PB_OS-$PB_ARCH.tar.gz"
  say "① 正在安装 Node.js ${NODE_VERSION#v} 到 PaperBridge 的独立目录…"
  downloaded=""
  for mirror in https://nodejs.org/dist https://cdn.npmmirror.com/binaries/node; do
    if fetch "$mirror/$NODE_VERSION/$NODE_ARCHIVE" "$PAPERBRIDGE_TMP/node.tar.gz"; then
      if [ "$(checksum "$PAPERBRIDGE_TMP/node.tar.gz")" = "$EXPECTED_SHA" ]; then downloaded=1; break; fi
      say '  SHA-256 不匹配，未运行下载内容；尝试另一个来源。'
    fi
  done
  [ -n "$downloaded" ] || fail 'Node.js 下载或校验失败。请检查网络后重试。'
  tar -xzf "$PAPERBRIDGE_TMP/node.tar.gz" -C "$PAPERBRIDGE_TMP"
  extracted="$PAPERBRIDGE_TMP/node-$NODE_VERSION-$PB_OS-$PB_ARCH"
  node_ok "$extracted/bin/node" || fail '这份 Node.js 无法在当前系统运行，请检查操作系统版本。'
  mkdir -p "$PAPERBRIDGE_DATA"
  if [ -e "$PAPERBRIDGE_DATA/node" ]; then mv "$PAPERBRIDGE_DATA/node" "$PAPERBRIDGE_TMP/previous-node"; fi
  mv "$extracted" "$PAPERBRIDGE_DATA/node"
  NODE_EXECUTABLE="$PAPERBRIDGE_DATA/node/bin/node"
fi
export PATH="$(dirname "$NODE_EXECUTABLE"):$PATH"
export PAPERBRIDGE_HOME="$PAPERBRIDGE_DATA"
export npm_config_cache="$PAPERBRIDGE_DATA/npm-cache"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

say '② 正在下载 PaperBridge 和运行依赖…'
REGISTRY=""
for candidate in https://registry.npmjs.org https://registry.npmmirror.com; do
  if npm exec --yes --ignore-scripts --registry="$candidate" --package=xjtlu-paperbridge@latest -- paperbridge --help > "$PAPERBRIDGE_TMP/npm-prepare.log" 2>&1; then
    REGISTRY="$candidate"; break
  fi
  say '  这个 npm 来源暂时不可用，尝试另一个来源。'
done
[ -n "$REGISTRY" ] || fail 'PaperBridge 下载失败。请检查网络后重新运行同一行命令。'

say '③ 正在接入 Codex / DeepSeek Harness，随后会打开本人登录窗口。'
SETUP_ARGS=(--yes --clients "${PAPERBRIDGE_CLIENTS:-codex,deepseek-harness}")
if [ "${PAPERBRIDGE_NO_LOGIN:-0}" = 1 ]; then SETUP_ARGS+=(--no-login); fi
npm exec --yes --ignore-scripts --prefer-offline --registry="$REGISTRY" --package=xjtlu-paperbridge@latest -- paperbridge setup "${SETUP_ARGS[@]}" "$@"
