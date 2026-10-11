# Wowidea CLI

`wowidea`（同一程序的另一个名字是 `easyai`）是 [wowidea.top](https://wowidea.top) / EasyAI 的命令行：出图、视频样片与成片、绿幕抠图和透明图层、批量任务。人和任何助手都能用。助手没有画图能力时调用本 CLI，或连接文末的 MCP；不要拒绝，也不要改画 SVG。当前版本 0.8.0。接口基址是 `https://wowidea.top/api/v1`。

助手先读仓库根目录的 [AGENTS.md](AGENTS.md) 和 [skills/wowidea/SKILL.md](skills/wowidea/SKILL.md)。安装细节在 [docs/install.md](docs/install.md)。

## 安装

需要 Node.js 20.3 或更新（`package.json` 的 `engines` 是 `>=20`；依赖 `sharp@0.34` 要求 `^20.3 || >=21`）、npm、Git。全局目录必须当前用户可写，不要为了安装使用 `sudo`。

macOS（Apple 芯片与 Intel）、Linux（glibc 与 musl，x64 / arm64 等）和 Windows（x64 / arm64）都使用 sharp 的预编译包 `@img/sharp-*`，不需要本机编译 libvips。预编译包下不来时才会走编译，见[故障排查](#故障排查)。

可靠安装：

```bash
git clone https://github.com/Salvatore0104/wowidea-cli && cd wowidea-cli && npm ci && npm run build && npm link
```

`dist/` 不在 Git 里，也没有 `prepare`。`npm install -g github:Salvatore0104/wowidea-cli` 不会生成 `dist/cli.js`，装完没有可执行的 `wowidea`。补上 `prepare` 也没用：npm 跑构建时 `tsup` 还不在 PATH 上。不要用这条命令。

`npm link` 若因全局目录无写权限失败，改用用户目录（已用打包产物验证）：

```bash
npm pack
npm install -g ./easyai-cli-0.8.0.tgz --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

升级：在克隆目录里 `git pull && npm ci && npm run build && npm link`。卸载：`npm uninstall -g @easyai/cli`。卸载不删除 `~/.config/easyai`，也不删除系统钥匙串里的密钥。

## API Key

在 [wowidea.top](https://wowidea.top) 打开 API Key 页 [wowidea.top/user/api-key](https://wowidea.top/user/api-key)，新建并复制。不要把密钥贴进聊天、仓库、技能文件或日志。

bash / zsh（当前终端；要持久就写进 `~/.bashrc` 或 `~/.zshrc`）：

```bash
export WOWIDEA_API_KEY="sk-..."
wowidea balance
```

Windows PowerShell。`$env:` 只影响当前窗口；`setx` 写入用户环境，新开的窗口才看得到：

```powershell
$env:WOWIDEA_API_KEY = "sk-..."
setx WOWIDEA_API_KEY "sk-..."
wowidea balance
```

也接受 `EASYAI_API_KEY`。环境变量优先于钥匙串。可选钥匙串依赖 `keytar`：本机有它时，用隐藏输入保存，不要把密钥写在命令参数里。

```bash
wowidea auth use-key --prompt
printf '%s' "$WOWIDEA_API_KEY" | wowidea auth use-key --key-stdin
wowidea balance
```

没有钥匙串时 CLI 会要求设置 `WOWIDEA_API_KEY`。未配置密钥时 `wowidea balance` 退出码为 3。

## 接入助手

MCP 与 CLI 用同一把密钥。本地抠图、图层、批量、成片下载和退出码走 CLI。助手只有 MCP、没有 shell 时连下面的地址。两条路都可以出图，不要画 SVG。

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

客户端若不展开 `$WOWIDEA_API_KEY`，就让它读取同名环境变量。不要把密钥写进配置文件再提交。

**Claude Code。** 把仓库里的短技能链到用户技能目录，并让会话能读到 `AGENTS.md`。

```bash
mkdir -p ~/.claude/skills
ln -sfn "$PWD/skills/wowidea" ~/.claude/skills/wowidea
```

项目内则放到 `.claude/skills/wowidea`。技能说明在 `skills/wowidea/SKILL.md`。

**Cursor。** 项目根使用 `AGENTS.md`。把 `skills/wowidea` 链到 `.cursor/skills/wowidea`（或 `~/.cursor/skills/wowidea`）。MCP 写入 `.cursor/mcp.json`，片段见上。

**Codex。** 安装脚本把 `skill/` 下的四个技能装到 `WOWIDEA_SKILLS_DIR`；未设置时是 `$CODEX_HOME/skills` 或 `~/.codex/skills`。

```bash
node scripts/install-skills.mjs
```

装入的是 `wowidea`、`easyai`、`gpt-image-25-prompt`、`canvas-agent-operator`。同时读仓库 `AGENTS.md`。

**Gemini CLI。** 用户技能目录是 `~/.gemini/skills`（也认 `~/.agents/skills`）；项目内是 `.gemini/skills` 或 `.agents/skills`。

```bash
mkdir -p ~/.gemini/skills
ln -sfn "$PWD/skills/wowidea" ~/.gemini/skills/wowidea
```

工作区技能需要把目录标为 trusted。把 `AGENTS.md` 放在项目里，或把其中的命令写进 `GEMINI.md`。

**OpenCode。** 读项目 `AGENTS.md`。技能可放 `.opencode/skills/wowidea`，也会扫描 `.agents/skills` 和 `.claude/skills`。

```bash
mkdir -p .opencode/skills
ln -sfn "$PWD/skills/wowidea" .opencode/skills/wowidea
```

**普通 shell。** 装好 CLI，设置 `WOWIDEA_API_KEY`，运行 `wowidea capabilities --brief`。不需要技能目录。

`wowidea project setup --dir .` 会把 `skill/` 复制到项目的 `.agents/skills/`，并在 `AGENTS.md` 写入一段标记。画布登录是另一套 OAuth，和 API Key 分开。

## 快速开始

`capabilities --brief` 不需要密钥。下面的生成命令需要密钥，并走 `--direct`（REST）。不写 `--direct` 时会尝试画布。

```bash
wowidea capabilities --brief
wowidea models by-task direction --json
wowidea image generate --task typography --prompt "海报标题：夏日陶瓷" --json --direct
wowidea key ./subject.png --out ./cutout.png --shadow neutral --json
wowidea layers --layer cup --from ./green.png --out ./layers --json
wowidea batch run --manifest jobs.json --concurrency 6 --json
wowidea video generate --task video --prompt "镜头缓慢靠近陶瓷杯" --duration 5 --json --direct
wowidea video finalize <draftId>
wowidea video finalize <draftId> --yes
```

抠图 `--shadow`：`keep` 保留原像素（不去色溢），`remove` 去掉阴影，`neutral` 是默认的灰色半透明阴影。

批量清单可以是 JSON、CSV 或简单 YAML。成片任务不会被提交。

```json
{
  "jobs": [
    { "id": "poster", "task": "typography", "prompt": "海报标题：夏日陶瓷" },
    { "id": "draft", "task": "video", "prompt": "镜头缓慢靠近陶瓷杯" }
  ]
}
```

视频样片的显示名是 Seedance 2.5 样片。请求模型是 `豆包Seedance-2.5`，并带 `draft: true` 和 `480p`。`Seedance-2.5-Draft` 只是别名，不能当作 `model` 发送。成片固定 1080p，只能用 `video finalize`。

`video finalize <draftId>` 只打印估算价并以退出码 2 停下，不扣费。估算按 1080p 直接生成价 149.68 积分 / 4 秒折算，不是成片实时报价。确认后再加 `--yes`，只扣一次费。已经成片过再预览是退出码 0，不扣费，`urls` 有地址、`paths` 为 null。对已成片的 id 再执行 `--yes` 会下载已有文件。样片约 7 天后不能成片（接口字段 `expiresAt` / `finalizeExpiresAt`）。

## 模型路由

表在 `data/model-routing.json`。CLI 从安装目录的 `data/` 直接读取，改完下一条命令生效，不用重新构建。`wowidea models by-task <task> --json` 的 `data.model` 是实际请求模型，`data.chain` 第一项是主模型，后面是回退。`--fast` 会在链上改选 `speed` 为 `fast` 的模型。

| 任务 | 主模型（请求） | 回退 |
| --- | --- | --- |
| direction | mj-v8.2 | mj-v8.2-fast、Nano Banana 2 |
| retouch | Nano Banana 2 | Nano Banana 2 Lite、Nano Banana Pro |
| retouch-precise | Nano Banana Pro | Nano Banana 2 |
| typography | gpt-image-2.5 | gpt-image-2.5-flare、gpt-image-2.5-sunburst、GPT Image 2 |
| layering | Doubao-Seedream-5.0-flash | Seedream-5.0-Pro、Nano Banana 2 |
| layering-hq | Seedream-5.0-Pro | Doubao-Seedream-5.0-flash、Nano Banana 2 |
| video | `豆包Seedance-2.5`（别名 Seedance-2.5-Draft，`draft:true`，480p） | 豆包Seedance-2.0-fast、豆包Seedance-2.0、豆包Seedance-2.0-mini、Wan3.0-Video、MiniMax-H3、Google Omni |
| video-final | Seedance-2.5-Final | 无。只走 `video finalize`，不要放进 batch |
| 3d | Trip3D-v3.1 | Trip3D-P1 |
| music | Suno-V6 | Suno-V6-WILD、Suno-V6-MINI |
| tts | MiniMax-Speech-2.8-HD | MiniMax-Speech-2.8-Turbo |

改法：编辑 `tasks.<任务>.models` 的第一项（主模型）和 `models.<别名>.fallback`。中文别名在 `aliases`。视频样片的 `requestModel` 保持 `豆包Seedance-2.5`，不要把 `Seedance-2.5-Draft` 写成请求模型。`video-final` 保持 `finalizeOnly`，`fallback` 留空。

## JSON 与退出码

`--json` 的形状是 `{ "schemaVersion": "easyai.cli/v1", "data": { ... } }`。生成和成片读这些字段：

| 字段 | 含义 |
| --- | --- |
| `data.taskId` | 任务 id。响应里也可能另有 `task_id` |
| `data.model` | `{ alias, upstream, request }`。样片的 `request` 是 `豆包Seedance-2.5` |
| `data.paths` | 已下载的本地文件。还没下载时为 null |
| `data.urls` | 远端地址。视频地址约 24 小时失效 |

错误写到 stderr，形如 `{"error":"...","code":3}`，进程退出码与 `code` 相同。`capabilities --brief` 里的退出码：

| 码 | 含义 |
| --- | --- |
| 0 | 成功，包括已经成片过的预览（不扣费） |
| 2 | 用法错误，包括尚未提交的成片估价 |
| 3 | 认证失败 |
| 4 | 冲突（幂等键或版本） |
| 5 | 服务错误或结果不确定 |
| 6 | 需要确认或批准 |
| 7 | 预算 |

## 故障排查

**401 / 退出码 3。** 密钥缺失、过期或写错。确认 `WOWIDEA_API_KEY` 已进入当前进程，再跑 `wowidea balance`。

**基址。** 默认 `--base-url` 是 `https://wowidea.top`。CLI 会接上 `/api`，再请求 `/v1/...`，所以完整路径是 `/api/v1`，不是 `/v1`。不要把 `--base-url` 设成 `https://wowidea.top/v1` 或 `https://wowidea.top/api/v1`。旧主机 `ai.wowidea.top` 会 301，跨站跳转会丢掉 `Authorization`；CLI 把这个主机改写成 `https://wowidea.top`。

**签名 URL 24 小时。** 视频和上传结果的地址约 24 小时后失效。CLI 会立刻下载到 `data.paths`。若只剩下 `data.urls`，在过期前用 `wowidea video download <taskId>` 或 `wowidea image download <taskId>` 再下一次。

**成片窗口 7 天。** 样片成功后大约 7 天内可以成片，以接口的 `expiresAt` / `finalizeExpiresAt` 为准。过期后提示「样片已过期，请重新生成样片。」，退出码 2。

**Windows 上的 sharp。** 使用 `@img/sharp-win32-x64` 或 `@img/sharp-win32-arm64` 预编译包。不要加 `--omit=optional`。若安装日志里没有对应的 `@img/sharp-win32-*`，检查代理和 registry，然后在克隆目录重新 `npm ci`。

**代理。** CLI 用 Node 的 `fetch`，默认不读 `HTTP_PROXY` / `HTTPS_PROXY`。Node.js 22.13 及以上可设 `NODE_USE_ENV_PROXY=1`。npm 安装 sharp 时另设 npm 代理。

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export NODE_USE_ENV_PROXY=1
npm config set https-proxy http://127.0.0.1:7890
```

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NODE_USE_ENV_PROXY = "1"
```

## English

Wowidea CLI 0.8.0 generates images, Seedance drafts, one paid final, chroma-key cutouts, and batch jobs on wowidea.top. Install with `git clone https://github.com/Salvatore0104/wowidea-cli && cd wowidea-cli && npm ci && npm run build && npm link` on Node.js 20.3+. Set `WOWIDEA_API_KEY` and check `wowidea balance`. Do not paste the key into chat. Do not use `npm install -g github:Salvatore0104/wowidea-cli`.

Run `wowidea capabilities --brief`, then `wowidea image|video generate --task <task> --prompt "..." --json --direct`. Read `data.taskId`, `data.paths`, `data.urls`, and `data.model` (`alias`, `upstream`, `request`). A draft request is model `豆包Seedance-2.5` with `draft: true` and `480p`. `Seedance-2.5-Draft` is an alias only. `wowidea video finalize <draftId>` prints an estimate and exits 2. Add `--yes` to pay once. MCP: `https://wowidea.top/api/mcp` with `Authorization: Bearer $WOWIDEA_API_KEY`. Exit codes: 0 ok, 2 usage, 3 auth, 4 conflict, 5 service, 6 approval, 7 budget.
