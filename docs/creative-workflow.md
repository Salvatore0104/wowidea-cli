# Wowidea 项目创作闭环

一次初始化，之后直接描述图片或视频需求即可。Codex 负责理解需求、选择模型、组织提示词和检查结果；CLI 负责网站接口、素材上传、任务提交、恢复、下载与版本记录。提交仅指媒体生成任务，不代表 Git 提交、网站发布或后台管理。

## 首次使用文案

> 请初始化当前目录并绑定同名 Wowidea 无限画布。以后图片、视频生成与修改默认在画布创建节点链，结果同时保留和下载；只有我明确指定 --direct 时才走旧接口。视频默认 Seedance 2.5 样片。成片只用 `wowidea video finalize <draftId> --yes`，先看估价。watermark:false。

## 初始化

```bash
wowidea --json project setup --dir <项目目录>
```

- 固定版本 CLI 写入 `<项目>/.wowidea/runtime/dist`，内部参考同时写入 `.wowidea/runtime/skill`。
- 创建专属远端画布并将精确 ID 写入 `<项目>/.wowidea/canvas.json`；已有绑定只验证和复用。
- 项目本地安装 Wowidea、EasyAI、GPT Image 2.5 和 Canvas Operator 四个 Skill。
- 在项目指令文件中维护一段可重复更新的 Wowidea 管理段；已存在 `AGENTS.override.md` 时写入该文件。
- 已存在用户文件、偏好或历史记录时不覆盖；重复初始化是幂等的。
- 需要升级固定版本或合并已修改资源时显式执行 `wowidea project setup --dir <项目目录> --update`；被用户改过的文件会列入 `preserved`，不会静默覆盖。
- 普通 API Key 与 Canvas OAuth 分离。两者只保存在系统凭据库或进程环境，项目、Skill、请求记录和 Git 都不保存凭据。
- 初始化和普通图片、视频项目不要求舞台信息；舞台与 VJ 流程仅在明确需要时加载。

初始化后，本次任务直接读取返回的项目指令；之后从该项目启动的任务通过项目指令与本地 Skill 自动发现规则，无需再次输入 `/wowidea`。

## 自动选模

顺序为：用户明确要求 → 实际能力约束 → 任务适配 → 网站价格与执行效率。

```bash
wowidea --json models route --kind image|video --purpose <用途> --stage preview|final|edit|refine
```

返回推荐模型与规格、选择理由、能力限制、预估费用与候选比较。显式 `--model` 与显式比例、分辨率、时长、音频和素材始终优先，不会为省成本静默降级。用途或测试／成片阶段不明确时，先输出 `needsInput` 供提问，不提交任务。

**图片**：风格探索偏 Midjourney；日常生成与参考修改 Nano Banana 2；精确文字／排版／复杂约束 GPT Image 2.5；细节精修 Nano Banana Pro。上表按任务适配，不要求串联调用。相同收费条件下优先取模型支持的更高分辨率，正式输出默认 4K；模型不支持时如实说明，不把缩放结果当作原生 4K。

**视频**：测试阶段优先满足能力的 Seedance Mini/Fast 480p，并结合真实价格与速度；H3 当前提供 720p／1440p，H3-Max 提供 480p／720p，按实际能力选择，不按名称推断价格。方向确认后正式输出默认考虑 720p，需要 1080p 时选择实际支持的模型（如 Seedance 2.5）。用户明确指定的模型、1080p 或时长直接遵循。未指定时长时，普通单镜头建议 5 秒起点。

## 价格与余额

网站模型定价通过显式快照接入，平台不提供公开读接口时不会引入管理员依赖：

```bash
wowidea --json prices import <snapshot.json>   # 导入带来源与时间的 wowidea.prices/v1 快照
wowidea --json prices show                     # 查看当前价格来源与更新时间
```

价格只按规则明确支持的维度（按次、按张、按秒、规格加价）估算，输出计费依据与更新时间；缺失或过期时明确显示未知，不编造最低价。预估费用仅用于选择与反馈，不阻止生成。

任务结果统一附带 `pointsUsage`：总余额、预占、可用余额、实际扣费、退款与查询状态。余额来自 `/v1/balance`；接口未返回实际扣费或退款时保持 `null`，显示“接口未提供”；只有接口明确表示待结算时才显示“待结算”。不使用账户余额差额冒充本次任务费用；余额查询失败不影响生成或下载。

## 生成、编辑与版本

```bash
wowidea --json image generate --file request.json --idempotency-key <UUID> --dir <输出目录>
wowidea --json image edit     --file edit.json    --idempotency-key <UUID> --parent <源任务ID> --change "<修改说明>"
wowidea --json video generate --file request.json --idempotency-key <UUID>
wowidea --json video edit     --file edit.json    --idempotency-key <UUID> --parent <源任务ID> --change "<修改说明>"
wowidea --json image generate --direct --file request.json # 仅显式兼容旧接口
```

- Seedance 必须使用经过分镜评审和明确批准的 manifest，任何创意或计费设置变化都会使批准失效。
- 本地素材在画布中创建可见来源节点并通过 Canvas 上传；生成节点通过实时声明的槽位绑定和连线。
- `image_urls`／`video_urls` 接受 HTTPS URL 或本地路径。编辑保留选定版本为参考，并记录 `--parent` 与 `--change`。
- 默认等待并下载；`--no-wait` 只返回受理结果。提交前持久化唯一任务键，任务受理后只查询原任务。
- 超时、进程中断、结果链接暂缺或下载失败都不会自动再次付费生成；改用 `status`／`watch`／`download` 或 `tasks resume`。
- 每轮记录写入 `.wowidea/canvas-runs/<key>.json`，保存精确 project/node/request/task ID。修改生成新节点和连线，原版不被覆盖。

## 交付与验收

查看实际输出后再描述质量；用户未要求时不自动进行付费审美重做。验收覆盖：初始化幂等与跨项目隔离、显式规格不被替换、图片不以低分辨率虚假省钱、视频阶段区分、定价按真实规则计算并标注缺失与过期、无审批 Seedance、生成与编辑的版本关联、临时素材过期重传、中断恢复不重复、余额零／小数／缺失／失败展示，以及类型检查、回归测试、资源一致性、构建、打包和独立项目初始化。
