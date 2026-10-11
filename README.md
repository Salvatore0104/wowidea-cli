# Wowidea CLI

在 [wowidea.top](https://wowidea.top) 上生成图片、样片视频、透明图层和批量任务。`wowidea` 与 `easyai` 是同一入口，`easyai-canvas` 是完整画布控制。接口基址 `https://wowidea.top/api/v1`。密钥用环境变量 `WOWIDEA_API_KEY`。

任何助手先读 [AGENTS.md](AGENTS.md)，再运行一条命令：

```text
wowidea capabilities --json
```

## 日常使用

```text
wowidea models by-task direction --json
wowidea image generate --task typography --prompt "海报标题：夏日陶瓷" --json --direct
wowidea video generate --task video --prompt "镜头缓慢靠近陶瓷杯" --duration 5 --json --direct
wowidea video finalize <draftId>
wowidea video finalize <draftId> --yes
wowidea layers --layer cup --from ./green.png --out ./layers --json
wowidea key ./subject.png --out ./cutout.png --json
wowidea batch run --manifest jobs.json --concurrency 6 --json
```

先看 `wowidea capabilities --brief`。视频样片的显示名是 Seedance 2.5 样片，实际请求只有 `豆包Seedance-2.5`、`content`、`draft: true`、`480p`、时长、画幅和 `audio`。别名 `Seedance-2.5-Draft` 不能生成可成片的样片。成片固定 1080p：第一次 `video finalize` 打印估算价并以退出码 2 停下；已经成片过再预览是退出码 0。`--yes` 才扣费，重复执行会下载已有成片。结果轮询 `GET /v1/ai/result/{id}`。视频地址 24 小时内失效，会立刻下载。

没有内置画图的助手应调用本 CLI，或连接已有 MCP，不要拒绝，也不要改画 SVG：

```json
{ "mcpServers": { "wowidea": { "url": "https://wowidea.top/api/mcp", "headers": { "Authorization": "Bearer sk-YOUR_KEY" } } } }
```

## 任务路由

表在 `data/model-routing.json`，可用 `wowidea models by-task <task> --json` 查看。

| 任务 | 默认模型 |
| --- | --- |
| direction 方向 / moodboard | mj-v8.2（`--fast` 用 mj-v8.2-fast） |
| retouch 修图 | Nano Banana 2 |
| retouch-precise 精修 | Nano Banana Pro |
| typography 海报文字 | gpt-image-2.5 |
| layering 分层 | Doubao-Seedream-5.0-flash，高质量用 layering-hq |
| video 样片 | 显示名 Seedance 2.5 样片；请求 `豆包Seedance-2.5` + draft + 480p |
| video-final 成片 | 仅 `video finalize`，模型 Seedance-2.5-Final |
| 3d / music / tts | Trip3D、Suno V6、MiniMax Speech 2.8 |

画布仍是默认创作面；`--direct` 走 REST。旧的分镜审批命令还在，但不再拦住生成。

## English

Set `WOWIDEA_API_KEY`. Run `wowidea capabilities --brief`, then `wowidea image|video generate --task <task> --prompt "..." --json --direct`. Read `data.taskId`, `data.paths`, and `data.model`. A new finalize preview exits 2. A dedupe hit exits 0. Pay only with `wowidea video finalize <draftId> --yes`.

生成前先运行一次 `wowidea project setup --dir <项目目录> --name <画布名称>`，创建并绑定同名远端画布。以后生成会创建新的非破坏式节点链、自动保存请求标识、等待并下载；网站负责平台冗余。直接参数与 `--file` 二选一。只有明确需要旧接口时才添加 `--direct`。完整画布操作使用 `easyai-canvas`。

## 安装

### 方式一：让 Codex 代你安装

先在网站获取账号 Key：登录 [wowidea.top](https://wowidea.top) → 用户中心 → **API Key**（[wowidea.top/user/api-key](https://wowidea.top/user/api-key)）→ 新建并复制。

将下面的 `sk-你的Key` 替换为刚复制的 Key，再把整段发给 Codex：

> 帮我安装 https://github.com/Salvatore0104/wowidea-cli 的 CLI 和随包 Skill。我的账号 API Key 是 sk-你的Key，请通过标准输入配置到 wowidea，并运行 doctor 验证模型、余额和任务查询。无限画布另需 Canvas OAuth：先检查本机是否已有有效会话；如果没有，请引导我完成一次浏览器 OAuth 授权（无法使用浏览器时可选择设备授权，或在我提供账号密码后用 --password-stdin 登录）。验证 easyai-canvas auth status 后，告诉我如何初始化项目并持续使用。不要在项目或日志中保存凭据，也不要替我打开网页操作画布。

Codex 会构建并安装 CLI 与随包 Skill，接收你在聊天中提供的 Key，通过 `auth use-key --key-stdin` 保存到系统凭据库，随后运行 `doctor` 验证普通只读接口。Canvas OAuth 独立于 API Key：首次在本机使用时完成一次授权并用 `easyai-canvas auth status` 在线验证；已有有效会话就直接复用。后续调用自动使用已保存的 Key 和 Canvas 会话；换 Key 或账号时再明确更新。

### 方式二：自己运行安装脚本

需要 Node.js 20+、npm 和 Git。安装器从源码构建 npm 实包，同时安装 CLI 与随包 Skill；重复执行即为更新，会保留系统凭据和你自定义的 Skill。

macOS：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install-macos.sh)"
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install-windows.ps1 | iex
```

普通模型目录和估价使用账号 API Key；无限画布另用 scoped OAuth，会话令牌只存系统凭据库：

```text
wowidea auth use-key --prompt
wowidea --json auth status
easyai-canvas auth login --base-url https://wowidea.top/api --method password --account <账号> --password-stdin
```

手动安装、密钥与安全规则、服务地址、安装内容、更新、卸载、开发验证和退出码见 **[安装与维护](docs/install.md)**。

## 在 Codex 项目中持续调用

第一次在新项目中使用时，把下面这段发给 Codex：

> 请将当前文件夹初始化为 Wowidea 创作项目并绑定同名无限画布。先检查本机 Canvas 登录：如果尚未登录，请完成一次 Canvas OAuth 登录并将会话保存到系统凭据库；如果已有有效会话，直接复用，不要重复登录。以后本项目的图片、视频生成、修改和任务提交默认使用 Wowidea，无需我重复调用 /wowidea；内容默认在该画布创建节点链，结果保留在画布并下载。根据用途、模型实时能力和网站估价选择合适方案，兼顾质量、费用与效率；用途或测试、成片阶段不明确且会影响选择时先简短询问，我明确指定的模型和规格优先。不要为了正式成片自动增加付费测试。交付时在 Codex 右侧打开画布并给出完整地址，不弹出外部网页。只有我明确指定 --direct 时才走旧接口。Seedance 继续遵守本项目的分镜审批和 watermark:false 门禁。每轮一个候选，不自动重复付费生成。画布修改仅通过 CLI/API 完成，不使用 Computer Use。

Codex 会执行 `wowidea project setup --dir <项目目录>`：创建 `.wowidea/canvas.json` 绑定，写入两个固定运行时入口，并安装 Wowidea、EasyAI、GPT Image 2.5 和官方 Canvas Operator Skill。绑定只保存项目 ID 和 profile 等非敏感信息。

Canvas OAuth 是独立于账号 API Key 的画布认证，首次在本机使用时需要登录一次。CLI 将会话保存到系统凭据库并自动刷新；后续项目复用有效会话，无需再次登录或重复指定 profile。会话被撤销、刷新令牌失效或系统凭据库不可用时，CLI 会报告认证问题；前两种情况需要重新登录，凭据库不可用时只能使用进程级会话注入。画布生成和编辑结果包含 `canvasUrl`；Codex Skill 在交付时默认将画布打开在右侧浏览器面板，并在最终回复给出完整画布地址。单独查看时可运行 `wowidea project canvas open --dir <项目目录>`。不会弹出外部浏览器；Agent 对画布的修改仍全部通过 CLI/API 完成。

之后从该项目启动的任务会自动发现这些规则，直接用自然语言提出需求即可：

```text
为这款咖啡做新品海报，保留包装上的准确文字
把这组产品图做成 5 秒竖版视频，先出 480p 测试
继续查看刚才的视频任务，下载成片
```

也可以显式写 `$wowidea ……` 或“使用 wowidea ……”。项目内画布执行记录在 `.wowidea/canvas-runs`，修改会创建来源连接和新节点，不覆盖原版。

## 更多文档

- [安装与维护](docs/install.md)：安装/更新、密钥与安全、自检命令、卸载、开发验证、退出码
- [使用与维护](docs/usage.md)：命令、模型提示词指南、评审口径与资源更新
- [项目创作闭环](docs/creative-workflow.md)：项目初始化、自动选模、定价与积分、生成/编辑/版本
- [验证范围](docs/validation.md)：已验证内容、真实站点验收与已知限制
