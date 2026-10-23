#!/usr/bin/env bash
set -euo pipefail

repo="${EASYAI_CLI_REPO:-https://github.com/Salvatore0104/wowidea-cli.git}"
ref="${EASYAI_CLI_REF:-master}"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/easyai-cli-install.XXXXXX")"
trap 'rm -rf "$workdir"' EXIT

command -v node >/dev/null || { echo "Node.js 20+ is required. Install it from https://nodejs.org/" >&2; exit 2; }
node -e 'const [major] = process.versions.node.split(".").map(Number); if (major < 20) process.exit(1)' || { echo "Node.js 20+ is required." >&2; exit 2; }
command -v git >/dev/null || { echo "git is required." >&2; exit 2; }

git clone --depth 1 --branch "$ref" "$repo" "$workdir"
cd "$workdir"
npm ci
npm run build
package_file="$(npm pack --silent)"
npm install --global "$workdir/$package_file"
node "$(npm root --global)/@easyai/cli/scripts/install-skills.mjs"
echo 'Wowidea installed. In Codex use $wowidea and provide your API key for automatic setup. Optional terminal input: wowidea auth use-key --prompt.'
prompt="$(npm root --global)/@easyai/cli/docs/prompts/首次安装.txt"
printf '%s\n' "首次安装完成。新开一个 AI 对话，把下面这段贴进去："
printf '%s\n' "文件：${prompt}"
printf '%s\n' "-----"
if [[ -f "$prompt" ]]; then
  cat "$prompt"
  printf '\n'
else
  printf '%s\n' "未找到话术提示词：${prompt}" >&2
fi
printf '%s\n' "-----"
