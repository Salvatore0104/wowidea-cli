# Wowidea CLI

`wowidea`（同一个程序也叫 `easyai`）是 [wowidea.top](https://wowidea.top) 的命令行：出图、视频样片与成片、绿幕抠图、透明图层、批量任务。当前版本 0.8.0。接口基址是 `https://wowidea.top/api/v1`。

生成默认走直接接口，不用额外加参数。每个目录在使用前都必须先初始化。没有 `.wowidea/project.json` 时，图片生成、视频生成、批量任务和需要新生成的图层都会停下来，并提示先运行 `wowidea project init`。已经初始化过的目录不要再次 init，以免覆盖偏好。

人和助手都能用。助手没有画图能力时调用本 CLI，或连接文末的 MCP。不要拒绝，也不要改画 SVG。

助手先读仓库根目录的 [AGENTS.md](AGENTS.md) 和 [skills/wowidea/SKILL.md](skills/wowidea/SKILL.md)。给人看的安装细节在 [docs/install.md](docs/install.md)，给助手的安装步骤在 [docs/agent-install.md](docs/agent-install.md)。

## 安装

需要 Node.js 20.3 或更新（`package.json` 的 `engines` 是 `>=20`；`sharp` 要求 `^20.3` 或 `>=21`）、npm、Git。全局目录必须当前用户可写，不要为了安装使用 `sudo`。

密钥在 [wowidea.top 的 API Key 页](https://wowidea.top/user/api-key) 新建。不要把密钥贴进聊天、仓库、技能文件或日志。

### 让助手安装

在 Cursor、Claude Code、Codex、Windsurf 或其他编程助手里粘贴下面这段。助手按 [docs/agent-install.md](docs/agent-install.md) 安装：密钥只放进环境变量 `WOWIDEA_API_KEY`，不回显，不写进仓库，不提交。

```text
帮我安装 wowidea-cli（https://github.com/Salvatore0104/wowidea-cli），按仓库 docs/agent-install.md 操作，我的 key 是 sk-你的Key
```

### 一句话安装

把密钥写在命令里可能会留在 shell 历史里。不带密钥的写法会隐藏输入，不进历史。

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.sh | WOWIDEA_API_KEY=sk-你的Key bash
```

Windows PowerShell：

```powershell
$env:WOWIDEA_API_KEY="sk-你的Key"; irm https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.ps1 | iex
```

不把密钥放进命令（脚本会提示输入）：

```bash
curl -fsSL https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.ps1 | iex
```

脚本把仓库放在 `~/.wowidea-cli`（Windows 为 `%USERPROFILE%\.wowidea-cli`），执行 `npm ci`、`npm run build`、`npm link`。全局目录不可写时改为 `npm pack` 后装进 `~/.local`，不使用 sudo。再运行一次就是升级。密钥优先交给 `wowidea auth use-key` 写入系统钥匙串；钥匙串不可用时，macOS / Linux 写入 `~/.bashrc` 和 `~/.zshrc`（已有的 `~/.bash_profile` 也会更新），Windows 用 `setx` 写入当前用户环境变量。装完会运行 `wowidea balance` 和 `wowidea capabilities --brief`。密钥无效时安装仍然成功。安装结束时会打印下面的初始化提示词，方便复制给助手。

### 手动安装

```bash
git clone https://github.com/Salvatore0104/wowidea-cli && cd wowidea-cli && npm ci && npm run build && npm link
```

`dist/` 不在 Git 里，也没有 `prepare`。`npm install -g github:Salvatore0104/wowidea-cli` 不会生成 `dist/cli.js`，装完没有可执行的 `wowidea`。补上 `prepare` 也没用：npm 跑构建时 `tsup` 还不在 PATH 上。不要用这条命令。

`npm link` 若因全局目录无写权限失败，改用用户目录：

```bash
npm pack
npm install -g ./easyai-cli-0.8.0.tgz --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

Windows 用户目录：`npm install -g .\easyai-cli-0.8.0.tgz --prefix "$env:USERPROFILE\.local"`，并把该目录下的 `bin` 加入 Path。

macOS（Apple 芯片与 Intel）、Linux（glibc 与 musl，x64 / arm64 等）和 Windows（x64 / arm64）都使用 sharp 的预编译包 `@img/sharp-*`，不需要本机编译 libvips。预编译包下不来时才会走编译，见[故障排查](#故障排查)。

升级：在克隆目录里 `git pull && npm ci && npm run build && npm link`。若当时装进了 `$HOME/.local`，重新 `npm pack`，再 `npm install -g ./easyai-cli-<版本>.tgz --prefix "$HOME/.local"`。

卸载：`npm uninstall -g @easyai/cli`。这会去掉 `wowidea` 和 `easyai`。卸载不删除 `~/.config/easyai`，也不删除系统钥匙串里的密钥。要停用密钥，到网站 API Key 页撤销，或执行 `wowidea auth logout`（只清钥匙串，不清环境变量）。

### API Key

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

也接受 `EASYAI_API_KEY`。环境变量优先于钥匙串。可选钥匙串依赖 `keytar`。本机有它时，用隐藏输入保存，不要把密钥写在命令参数里。

```bash
wowidea auth use-key --prompt
printf '%s' "$WOWIDEA_API_KEY" | wowidea auth use-key --key-stdin
wowidea balance
```

没有钥匙串时 CLI 会要求设置 `WOWIDEA_API_KEY`。未配置密钥时 `wowidea balance` 退出码为 3。

## 安装后的初始化提示词

每个项目目录在使用前都要先初始化。把下面这段原样交给 AI 助手。安装脚本结束时也会打印同一段。

```text
请在当前项目目录用 wowidea-cli 初始化，然后再生成图片或视频。每次在一个目录里使用之前，都要先确认该目录已经初始化。没有 .wowidea/project.json 时再执行 init。已经初始化过的目录不要覆盖。

初始化（把项目名称换成实际名称）：
wowidea project init --dir . --name "项目名称"

如果提示项目已存在，说明这个目录已经初始化过，直接继续使用，不要再次执行 init。

生成默认走直接接口，不需要加 --direct。

常用命令：
wowidea capabilities --brief
wowidea models by-task <task> --json
wowidea image generate --task <task> --prompt "..." --json
wowidea video generate --task video --prompt "..." --duration 5 --json
wowidea video finalize <draftId>
wowidea video finalize <draftId> --yes
wowidea key ./subject.png --out ./cutout.png --json
wowidea layers --layer subject --from ./green.png --out ./layers --json
wowidea batch run --manifest jobs.json --concurrency 6 --json
wowidea project show --dir .

典型流程：先运行 capabilities --brief，再用 models by-task 确认模型和参数，然后执行 image generate 或 video generate。读取返回里的 data.taskId、data.paths 和 data.model（alias、upstream、request）。视频样片的请求模型是 豆包Seedance-2.5，并带 draft:true 和 480p，不要把 Seedance-2.5-Draft 当作 model 发送。成片只用 video finalize：不加 --yes 时只打印估价并以退出码 2 结束；确认后再加 --yes，只扣一次费。没有画图工具时调用本 CLI，或连接 MCP https://wowidea.top/api/mcp，请求头为 Authorization: Bearer $WOWIDEA_API_KEY。不要拒绝，也不要画 SVG。密钥只放在环境变量 WOWIDEA_API_KEY 里，不要写进仓库。
```

## 使用

先在当前目录初始化，再生成。生成默认走直接接口。

### 每个目录先初始化

换一个目录就要再初始化一次。`project init` 写入 `.wowidea/project.json`，并且拒绝覆盖已有项目。

```bash
wowidea project init --dir . --name "夏日陶瓷"
wowidea project show --dir .
wowidea project validate --dir .
```

目录还没有项目文件时，`wowidea project setup --dir .` 会先初始化，并把 `skill/` 复制到 `.agents/skills/`，在 `AGENTS.md` 写入一段标记。生成前仍然要确认 `.wowidea/project.json` 已经存在。

### 常用命令

`capabilities --brief` 不需要密钥。下面的生成命令需要密钥。

```bash
wowidea capabilities --brief
wowidea models by-task direction --json
wowidea image generate --task typography --prompt "海报标题：夏日陶瓷" --json
wowidea image edit --prompt "只把背景换成绿色" --reference ./product.png --json
wowidea key ./subject.png --out ./cutout.png --shadow neutral --json
wowidea layers --layer cup --from ./green.png --out ./layers --json
wowidea batch run --manifest jobs.json --concurrency 6 --json
wowidea video generate --task video --prompt "镜头缓慢靠近陶瓷杯" --duration 5 --json
wowidea video finalize <draftId>
wowidea video finalize <draftId> --yes
```

读返回里的 `data.taskId`、`data.paths`、`data.urls` 和 `data.model`（`alias`、`upstream`、`request`）。

抠图 `--shadow`：`keep` 保留原像素（不去色溢），`remove` 去掉阴影，`neutral` 是默认的灰色半透明阴影。`layers` 在不传 `--from`、需要新生成底图时，同样要求当前目录已经初始化。

批量清单可以是 JSON、CSV 或简单 YAML。成片任务不会被提交。批量也要求当前目录已经初始化。

```json
{
  "jobs": [
    { "id": "poster", "task": "typography", "prompt": "海报标题：夏日陶瓷" },
    { "id": "draft", "task": "video", "prompt": "镜头缓慢靠近陶瓷杯" }
  ]
}
```

### 视频样片与成片

视频样片的显示名是 Seedance 2.5 样片。请求模型是 `豆包Seedance-2.5`，并带 `draft: true` 和 `480p`。`Seedance-2.5-Draft` 只是别名，不能当作 `model` 发送。成片固定 1080p，只能用 `video finalize`。

`video finalize <draftId>` 只打印估算价并以退出码 2 停下，不扣费。估算按 1080p 生成价 149.68 积分 / 4 秒折算，不是成片实时报价。确认后再加 `--yes`，只扣一次费。已经成片过再预览是退出码 0，不扣费，`urls` 有地址、`paths` 为 null。对已成片的 id 再执行 `--yes` 会下载已有文件。样片约 7 天后不能成片（接口字段 `expiresAt` / `finalizeExpiresAt`）。

### 模型路由

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

### 接入助手

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

**Codex。** 安装脚本把 `skill/` 下的三个技能装到 `WOWIDEA_SKILLS_DIR`；未设置时是 `$CODEX_HOME/skills` 或 `~/.codex/skills`。

```bash
node scripts/install-skills.mjs
```

装入的是 `wowidea`、`easyai`、`gpt-image-25-prompt`。同时读仓库 `AGENTS.md`。

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

**普通 shell。** 装好 CLI，设置 `WOWIDEA_API_KEY`，在要用的目录里先 `wowidea project init`，再运行 `wowidea capabilities --brief`。

### JSON 与退出码

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
| 2 | 用法错误，包括尚未初始化、以及尚未提交的成片估价 |
| 3 | 认证失败 |
| 4 | 冲突（幂等键或版本） |
| 5 | 服务错误或结果不确定 |
| 6 | 需要确认或批准 |
| 7 | 预算 |

## 故障排查

**401 / 退出码 3。** 密钥缺失、过期或写错。确认 `WOWIDEA_API_KEY` 已进入当前进程，再跑 `wowidea balance`。

**退出码 2，提示尚未初始化。** 当前目录没有 `.wowidea/project.json`。运行 `wowidea project init --dir . --name "项目名称"`。若提示项目已存在，直接继续使用。

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
