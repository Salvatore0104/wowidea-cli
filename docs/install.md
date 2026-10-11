# 安装与维护

主入口与日常用法见 [README](../README.md)；命令、模型与评审口径见 [使用与维护](usage.md)。

## 给任意助手

密钥放在 `WOWIDEA_API_KEY`（也接受 `EASYAI_API_KEY`）。不要把密钥写进仓库、日志或技能文件。

| 助手 | 技能位置 |
| --- | --- |
| Claude Code | `~/.claude/skills/wowidea` |
| Cursor | 项目 `skills/wowidea` 或 `.cursor/rules`，先读 `AGENTS.md` |
| Codex | `~/.codex/skills/wowidea`（`scripts/install-skills.mjs`） |
| 其他 | 直接运行 CLI，或连接 MCP `https://wowidea.top/api/mcp` |

先运行 `wowidea capabilities --json`。它离线返回任务、命令和参数，不需要密钥。

## 让 Codex 代你安装（推荐）

先取得账号 Key：登录 [wowidea.top](https://wowidea.top) → 用户中心 → **API Key**（[wowidea.top/user/api-key](https://wowidea.top/user/api-key)）→ 新建并复制。

把下面这段发给 Codex：

> 帮我安装 https://github.com/Salvatore0104/wowidea-cli 的 CLI 和随包 Skill。我会在聊天中提供 API Key，请通过标准输入配置并运行 doctor。再检查 Canvas OAuth 会话；如果没有有效会话，帮助我完成一次浏览器授权（或我明确选择的设备/密码登录），用 easyai-canvas auth status 在线验证。后续复用已保存的会话，不重复登录。

Codex 会构建并安装 CLI 和 Skill。你可直接在聊天中提供用于配置的 Key，Codex 通过标准输入调用 `wowidea auth use-key --key-stdin` 保存到系统凭据库，再运行 doctor；无需你额外操作终端。doctor 只验证 API Key 的只读接口；无限画布另用 Canvas OAuth，需要在线检查 `easyai-canvas auth status`。浏览器 OAuth 是首次登录的一种方式，登录后会话在系统凭据库中复用。更换 Key 时重复配置流程即可覆盖旧值。

## 环境要求

Node.js 20+、npm 和 Git。npm 全局目录需当前用户可写，**不要**为了安装默认使用 `sudo`。

## 一键安装 / 更新

安装器从源码构建 npm 实包，同时安装 CLI 与随包 Skill。**重复执行就是更新**：保留系统凭据和你修改过的 Skill，待合并的新文件存于配置目录 `skill-updates`，安装结果会列出路径。

macOS：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install-macos.sh)"
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install-windows.ps1 | iex
```

## 手动安装（从源码）

```bash
git clone --depth 1 --branch master https://github.com/Salvatore0104/wowidea-cli.git wowidea-src
cd wowidea-src
npm ci
npm run build
npm pack
npm install -g ./easyai-cli-<版本>.tgz
node "$(npm root -g)/@easyai/cli/scripts/install-skills.mjs"
```

不要使用 `npm install -g .` 从临时目录安装，会留下失效链接。Codex 也可以克隆仓库后查看并运行对应安装脚本。

## 账号密钥

Key 在网站生成：登录 [wowidea.top](https://wowidea.top) → 用户中心 → **API Key**（[wowidea.top/user/api-key](https://wowidea.top/user/api-key)）→ 新建并复制。自动化测试可通过进程环境或标准输入注入临时 Key。

推荐直接在聊天中把 Key 交给 Codex 配置。Codex 使用 `wowidea auth use-key --key-stdin`，通过进程标准输入传入 Key，保存后验证连接。明确仅供临时测试的 Key 使用进程注入，不自动永久保存。

也可自行在交互终端隐藏输入：

```text
wowidea auth use-key --prompt
wowidea --json auth status
wowidea --json doctor
```

- 无人值守时可安全注入 `EASYAI_API_KEY`，或用 `--api-key-stdin`。
- 支持聊天提供 Key 并由 Codex 代配置；不回显 Key，不把它写进项目、Skill、记忆或 GitHub。
- 凭据库不可用时会直接报错，不会回退到明文配置。
- 账号 Key 是账号级自动化权限，可在网站立即撤销；使用 Key 的普通只读接口无需浏览器登录。无限画布使用独立 Canvas OAuth，首次登录可选择浏览器、设备或密码标准输入方式。

## 安装后自检

```text
wowidea --json auth status
wowidea --json models route --kind image
wowidea --json models list --type image
wowidea --json balance
wowidea --json tasks list
wowidea --json tasks remote --page 1 --page-size 20
```

- `tasks list` 读本机提交记录（恢复和防重复用）；`tasks remote` 才是当前账号在服务器上的任务列表，可按页翻查。
- `models list --type image|video` 只列出真正能产出该媒体的模型；平台会忽略 `?type=`，过滤在本地完成。需要平台原始类型（例如 `image_analysis`）时直接传入该类型。
- `models show <id>` 同时接受平台 id 与随包显示名，例如 `mj-v8.2` 和 `Midjourney v8.2` 指向同一模型。

## 服务地址

默认服务地址是 `https://wowidea.top`。旧的 `ai.wowidea.top` 会 301 跳转，普通 HTTP 客户端在跨站跳转时会丢掉 `Authorization` 头并表现为 401；CLI 将旧别名规范化到默认地址；只读请求仅允许同源或明确可信别名跳转，不允许 HTTPS 降级，也不通过重定向重发生成请求。

## 安装保存了什么

- 系统凭据库保存账号 API Key。
- `~/.config/easyai`（或 `EASYAI_CONFIG_DIR`）保存非秘密默认模型、安装版本、任务索引、价格快照与报价 hash。任务索引按服务器及凭据分区，换 Key 后仍可用已知 taskId 查询，不会把旧 Key 的任务错误关联到新账号。
- Skill 默认安装到 `CODEX_HOME/skills`（未配置时为 `~/.codex/skills`），可用 `WOWIDEA_SKILLS_DIR` 指定。避免在 `.agents/skills` 和 `.codex/skills` 同时安装同名副本。
- 本地 Seedance manifest / 请求文件可能包含临时签名 URL，属于私密执行材料，不应提交版本库；日志输出会脱敏。

## 更新与保留

安装器从当前包发现并安装 `wowidea`、`easyai`、`gpt-image-25-prompt` 和官方 `canvas-agent-operator` 四个 Skill，默认保留用户修改与账号状态；新旧冲突文件进入配置目录 `skill-updates` 等待合并。`easyai-canvas` 使用独立入口和 scoped OAuth，令牌只写系统凭据库。

维护者更新来源摘要、许可与资源链接后运行 `npm run resources:lock`，再运行 `npm run check`、Skill 校验与实际 `npm run package:smoke -- <tgz>`。不得在运行时自动同步上游；当前资料只保留最终说明，源代码历史仍可通过 Git 查询。

## 卸载

`npm uninstall -g @easyai/cli` 删除三个 CLI 命令。需要移除 Skill 时，只删除安装记录 `installedSkills` 列出的本包目录，并先保留自定义修改。API Key、Canvas OAuth 会话和任务索引默认不删除；撤销凭据是独立操作。

## 开发与验证

```bash
npm ci
npm run check
npm pack --dry-run
npm run package:smoke -- easyai-cli-<版本>.tgz
```

`npm run check` 依次执行资源一致性、类型检查、构建与行为测试。发布范围与已知限制见 [验证范围](validation.md)。

## 退出码

`0` 成功；`2` 参数错误；`3` 认证失败；`4` 版本/幂等冲突；`5` 服务错误或结果不确定；`6` 能力未验证或需要补充确认。

## Skill 来源与许可

来源与许可证见 [来源记录](../skill/wowidea/references/sources.md)。社区 Seedance 创作指南固定提交并保留 MIT；MiniMax H3 已依据官方 h3-prompt-writing 结构更新，适配文档不伪称官方原包；Seedance 2.5 官方 sd25-pe 分发端点本次未能取得，采用可核验的官方文档原创总结。生成过程中不临时下载任何上游代码。

## 项目内独立运行

`project setup` 会携带当前系统的 keytar 原生运行文件，并返回 credentialRuntime 的可用性和平台信息；更换操作系统或架构后重新执行 setup --update。凭据模块缺失时使用 EASYAI_API_KEY 或 --api-key-stdin，不回退到明文文件。auth status 表示本地凭据存在；doctor 才验证网站连接。

生成 POST 默认最多等待 15 分钟，为网站的平台冗余留出时间；这不是重试次数。拿到任务 ID 后只查询同一任务，最多观察 30 分钟。已拒绝、失败或归属不明的任务不会自动重新生成。
