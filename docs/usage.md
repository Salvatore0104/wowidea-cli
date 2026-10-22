# Wowidea 使用与维护

Skill 指令为英文，默认仍用用户语言交流。`$wowidea` 是媒体执行与自动选模入口；GPT Image 2.5 的纯提示词润色也可直接调用 `$gpt-image-25-prompt`，不会产生费用。

## 提示词指南

模型提示词方法是随包内部参考，由 `$wowidea` 按任务选择，也可直接读取：

| 模型 | CLI读取 |
| --- | --- |
| H3 | `wowidea --json guides show minimax-h3` |
| Seedance 2.0 | `wowidea --json guides show seedance-20` |
| Seedance 2.5 | `wowidea --json guides show seedance-25` |
| GPT Image 2 | `wowidea --json guides show gpt-image` |
| GPT Image 2.5 | `wowidea --json guides show gpt-image-25`，提示词润色使用 `$gpt-image-25-prompt` |
| Nano Banana | `wowidea --json guides show nano-banana` |
| Midjourney v8.2 | `wowidea --json guides show midjourney` |

例如：“用 $wowidea 为咖啡新品写海报提示词，标题保留中文，使用 GPT Image 2.5。”或“用 $wowidea 整理 MiniMax H3 图片全能参考，图1保留商品，背景可以改变。”每份指南包含模式、参考绑定、完整例子与平台缺口。

## 项目与执行

每次在一个目录里生成图片或视频之前，先运行 `wowidea project init --dir <目录> --name <名称>`。已有 `.wowidea/project.json` 时不要再次 init。`project setup` 会复制技能并在缺少项目文件时一并初始化。

生成可直接使用 `--prompt`、`--model`、`--reference`、`--resolution`、`--ratio` 等参数，也可以使用 UTF-8 请求文件，两种输入方式不可混用。生成默认走直接接口，不必加 `--direct`。中断后用 `tasks resume` 或 `image|video status|watch|download` 查询同一任务。Seedance 成片只用 `video finalize`。

任务查看分两处：`tasks list`只读本机提交记录，用于恢复和防重复；`tasks remote --page 1 --page-size 20`读取服务器上当前账号的任务，是真正意义上的历史列表。`models list --type image|video`只列出能产出该媒体的模型，过滤在本地完成（平台会忽略 `?type=` 参数），需要平台原始类型时可直接传如 `image_analysis`。`models show <id>` 同时接受平台 id 与随包显示名，例如 `mj-v8.2` 和 `Midjourney v8.2` 都指向同一模型。

图片、文字、产品、插画、视频与舞台各用对应评审标准。媒体必须实际查看后评价。最终格式、印刷源文件、可编辑矢量、无缝循环或现场多屏若未实际实现，明确列为待完成。

## 更新与保留

安装器从当前包发现全部Skill入口并安装，默认保留用户修改与账号状态。新旧冲突文件进入配置目录skill-updates等待合并。随包入口为 `wowidea` 与兼容用 `easyai`，不覆盖用户原装的Flova、H3、Seedance或GRSAI工具。升级后在新对话中使用新Skill；是否即时刷新由宿主决定。

维护者更新来源摘要、许可与资源链接后运行resources:lock，再运行check、Skill校验及实际package:smoke。不得在运行时自动同步上游。当前资料只保留最终说明；源代码历史仍可通过Git查询。

## 随包模型指南

模型提示词方法随包安装为 `$wowidea` 的内部参考，由单一入口按任务选择；指令为英文，交流和准确文案仍保留用户语言：

| 模型 | 随包指南 | CLI读取 |
| --- | --- | --- |
| MiniMax H3 / H3-Max | `references/minimax-h3.md` | `wowidea --json guides show minimax-h3` |
| Seedance 2.0 系列 | `references/seedance-20.md` | `wowidea --json guides show seedance-20` |
| Seedance 2.5 | `references/seedance-25.md` | `wowidea --json guides show seedance-25` |
| GPT Image 2 | `references/gpt-image.md` | `wowidea --json guides show gpt-image` |
| GPT Image 2.5 / Flare / Sunburst | `references/gpt-image-25.md` + `$gpt-image-25-prompt` | `wowidea --json guides show gpt-image-25` |
| Nano Banana 系列 | `references/nano-banana.md` | `wowidea --json guides show nano-banana` |
| Midjourney v8.2 / 8.2-fast | `references/midjourney.md` | `wowidea --json guides show midjourney` |

只写提示词不会调用付费生成。例如：“用 $wowidea 为咖啡新品写海报提示词，标题保留中文，使用 GPT Image 2.5。”或“用 $wowidea 整理 MiniMax H3 图片全能参考，图1保留商品，背景可以改变。”每份指南包含模式、参考绑定、完整例子与平台缺口。可用 `wowidea --json guides list` 查看全部随包资源。

## 内置模型与默认

内置 Nano Banana 2/Pro/2 Lite、GPT Image 2 与 2.5（含 Sunburst／Flare）、Midjourney v8.2/8.2-fast、MiniMax H3/H3-Max、Google Omni、Wan3.0/Prime、Seedance 2.0/2.0-fast/2.0-mini/2.5 指南。运行时以当前账号模型目录为准：Google Omni 不推定上游型号，Seedance 2.5 不继承 2.0 的参数限制，Midjourney 只走参数尾部语法。图片默认 Nano Banana 2。视频样片默认请求 `豆包Seedance-2.5`（`draft: true`，480p）；`Seedance-2.5-Draft` 只是别名。用户指定的模型、比例、分辨率、时长和素材优先，模型不可用时明确提示，不擅自替换。

## 异步任务与生成

生成不设置积分确认阈值。结果返回任务状态、媒体路径、预估价格与可查询余额；实际扣费未知时明确标记为“接口未提供”，不用余额差额推算单任务费用。定价优先取网站计价接口，折扣自动包含；接口不可用时回退到带来源与时间的价格快照。

## 安装与更新

安装、密钥、自检、卸载与退出码见 [安装与维护](install.md)。
