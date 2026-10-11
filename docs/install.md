# 安装与维护

日常命令、路由表和 JSON 字段见 [README](../README.md)。本文只覆盖装上、配密钥、接入助手和排错。命令与 `wowidea --help`、`wowidea capabilities --brief` 一致。

## 环境

- Node.js 20.3 或更新。`package.json` 写的是 `>=20`；`sharp@0.34` 要求 `^18.17 || ^20.3 || >=21`，因此 Node 20 请用 20.3 起。
- npm、Git。
- 全局目录当前用户可写。不要默认使用 `sudo`。

sharp 在 macOS（arm64 / x64）、Linux（glibc 与 musl）和 Windows（x64 / arm64）上使用 `@img/sharp-*` 预编译二进制，不需要本机安装 libvips。

## 从 GitHub 安装

```bash
git clone https://github.com/Salvatore0104/wowidea-cli && cd wowidea-cli && npm ci && npm run build && npm link
```

装完应能运行：

```bash
wowidea --version
wowidea capabilities --brief
```

`wowidea` 与 `easyai` 指向同一个 `dist/cli.js`。`easyai-canvas` 是画布入口。

`npm link` 报 `EACCES` 时，不要用 sudo。把包装进用户目录：

```bash
npm pack
npm install -g ./easyai-cli-0.8.0.tgz --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

Windows 用户目录示例：`npm install -g .\easyai-cli-0.8.0.tgz --prefix "$env:USERPROFILE\.local"`，并把该目录下的 `bin` 加入 Path。

不要运行 `npm install -g github:Salvatore0104/wowidea-cli`。`dist/` 被 gitignore，仓库没有 `prepare`，安装结果里没有 `dist/cli.js`。给 `prepare` 接上 `npm run build` 也不能修好：那个脚本执行时，开发依赖 `tsup` 还不在 PATH 上。

仓库里的 `scripts/install-macos.sh` 和 `scripts/install-windows.ps1` 做的是同一套克隆、`npm ci`、`npm run build`、`npm pack`、再全局安装压缩包，并调用 `scripts/install-skills.mjs`。需要看清每一步时，用上面的克隆命令。

## 升级与卸载

在克隆目录：

```bash
git pull
npm ci
npm run build
npm link
```

若当时是用压缩包装进 `$HOME/.local`，重新 `npm pack` 再 `npm install -g ./easyai-cli-<版本>.tgz --prefix "$HOME/.local"`。

卸载命令：

```bash
npm uninstall -g @easyai/cli
```

这会去掉 `wowidea`、`easyai`、`easyai-canvas`。密钥在环境变量或钥匙串里，配置在 `~/.config/easyai`（或 `EASYAI_CONFIG_DIR`）。卸载不删除它们。要停用密钥，到网站 API Key 页撤销，或执行 `wowidea auth logout`（只清钥匙串，不清环境变量）。

## API Key

1. 登录 [wowidea.top](https://wowidea.top)，打开 [API Key](https://wowidea.top/user/api-key)，新建并复制。
2. 只放进环境变量或本机钥匙串。不要贴进聊天、仓库、技能或日志。

bash / zsh：

```bash
export WOWIDEA_API_KEY="sk-..."
wowidea balance
```

PowerShell。`$env:` 是当前窗口；`setx` 是用户级持久变量，要新开窗口才生效：

```powershell
$env:WOWIDEA_API_KEY = "sk-..."
setx WOWIDEA_API_KEY "sk-..."
wowidea balance
```

`EASYAI_API_KEY` 仍可用。进程环境变量优先于钥匙串。

钥匙串是可选依赖 `keytar`。有它时：

```bash
wowidea auth use-key --prompt
printf '%s' "$WOWIDEA_API_KEY" | wowidea auth use-key --key-stdin
wowidea auth status
wowidea balance
```

`--prompt` 需要本机交互终端。没有 keytar 时，错误会要求设置 `WOWIDEA_API_KEY`，不会把密钥写成明文文件。未登录时 `wowidea balance` 退出码为 3。

## 各助手

技能源文件是仓库里的 `skills/wowidea/SKILL.md`。路由摘要是根目录 `AGENTS.md`。Codex 的完整技能包在 `skill/`，由 `scripts/install-skills.mjs` 安装。

MCP（与 CLI 同一密钥）：

```json
{
  "mcpServers": {
    "wowidea": {
      "url": "https://wowidea.top/api/mcp",
      "headers": {
        "Authorization": "Bearer $WOWIDEA_API_KEY"
      }
    }
  }
}
```

用 CLI 的场合：本地图片抠图和分层、批量清单、成片下载、退出码、改 `data/model-routing.json`。用 MCP 的场合：助手没有 shell，只能调远程工具。没有画图模型时两条都可以，不要画 SVG，也不要拒绝。

**Claude Code。** 个人技能目录 `~/.claude/skills/wowidea`，项目内 `.claude/skills/wowidea`。

```bash
mkdir -p ~/.claude/skills
ln -sfn "$PWD/skills/wowidea" ~/.claude/skills/wowidea
```

让会话读到 `AGENTS.md`。

**Cursor。** 项目根放 `AGENTS.md`。把 `skills/wowidea` 链到 `.cursor/skills/wowidea` 或 `~/.cursor/skills/wowidea`。MCP 放在 `.cursor/mcp.json`。

**Codex。**

```bash
node scripts/install-skills.mjs
```

目标目录是 `WOWIDEA_SKILLS_DIR`，否则是 `$CODEX_HOME/skills` 或 `~/.codex/skills`。装入 `wowidea`、`easyai`、`gpt-image-25-prompt`、`canvas-agent-operator`。重复执行会保留你改过的技能文件。

**Gemini CLI。** `~/.gemini/skills/wowidea`，或项目 `.gemini/skills/wowidea`。也认 `.agents/skills`。工作区技能需要 trusted。`AGENTS.md` 放在项目中，或把命令抄进 `GEMINI.md`。

```bash
mkdir -p ~/.gemini/skills
ln -sfn "$PWD/skills/wowidea" ~/.gemini/skills/wowidea
```

**OpenCode。** 读项目 `AGENTS.md`。技能目录 `.opencode/skills/wowidea`，同时会看 `.agents/skills` 和 `.claude/skills`。

```bash
mkdir -p .opencode/skills
ln -sfn "$PWD/skills/wowidea" .opencode/skills/wowidea
```

**普通 shell。** 只需要全局命令和 `WOWIDEA_API_KEY`。先跑 `wowidea capabilities --brief`。

可选：`wowidea project setup --dir .` 把 `skill/` 复制到 `.agents/skills/`，并在 `AGENTS.md` 写入 `<!-- wowidea:begin -->` 段。画布使用独立的 Canvas OAuth，不是这把 API Key。

## 装完检查

```bash
wowidea capabilities --brief
wowidea models by-task video --json
wowidea balance
```

第一条离线，应看到样片模型 `豆包Seedance-2.5`、`draft=true`、`480p`，以及别名说明。第二条同样离线。第三条用密钥读余额；`--json` 时看 `data.total`。

## 故障排查

**401，退出码 3。** 当前进程没有密钥，或密钥无效。`echo` 是否设置了变量即可，不要把值打出来。然后 `wowidea balance`。

**路径是 `/api/v1`，不是 `/v1`。** 默认基址 `https://wowidea.top`。CLI 在基址后加 `/api`，再请求 `/v1/models` 等，完整 URL 如 `https://wowidea.top/api/v1/models`。`--base-url` 不要写成带 `/v1` 或 `/api/v1` 的地址。`ai.wowidea.top` 的 301 会让普通客户端丢掉 `Authorization`；CLI 会把该主机规范成 `https://wowidea.top`。

**签名 URL 约 24 小时失效。** 生成结果应立刻落在 `data.paths`。只拿到 `data.urls` 时，过期前执行 `wowidea image download <taskId>` 或 `wowidea video download <taskId>`。

**成片窗口约 7 天。** 以样片结果里的 `expiresAt` 或 `finalizeExpiresAt` 为准。过期后 `video finalize` 退出码 2，提示重新生成样片。未加 `--yes` 的成片命令只估价，也是退出码 2，不会扣费。

**Windows sharp。** 正常情况会装上 `@img/sharp-win32-x64` 或 `@img/sharp-win32-arm64`。不要使用 `--omit=optional`。缺少预编译包时，先配好 npm 代理再在仓库里重新 `npm ci`。

**代理。** 运行时的 `fetch` 默认忽略 `HTTP_PROXY` 和 `HTTPS_PROXY`。Node.js 22.13+ 设置 `NODE_USE_ENV_PROXY=1` 后才会使用它们。安装依赖时的代理用 npm 自己的配置。

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export NODE_USE_ENV_PROXY=1
npm config set https-proxy http://127.0.0.1:7890
```

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NODE_USE_ENV_PROXY = "1"
```

## 退出码

与 `wowidea capabilities --brief` 相同。

| 码 | 含义 |
| --- | --- |
| 0 | 成功，包括已成片的预览（不扣费） |
| 2 | 用法错误，包括未提交的成片估价 |
| 3 | 认证失败 |
| 4 | 冲突 |
| 5 | 服务错误或结果不确定 |
| 6 | 需要确认或批准 |
| 7 | 预算 |
