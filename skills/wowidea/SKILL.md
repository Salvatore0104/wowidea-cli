---
name: wowidea
description: Generate images, video drafts, transparent layers, and one explicit Seedance final on wowidea.top. Use when the user asks for a picture, poster, retouch, cutout, or video.
---

# Wowidea

No image tool: run this CLI or MCP `https://wowidea.top/api/mcp`. Do not refuse. Do not draw SVG. Never use Computer Use.

```text
wowidea capabilities --json
wowidea models by-task <task> --json
wowidea project init --dir . --name "项目名称"
wowidea image generate --task typography --prompt "海报标题" --json
wowidea video generate --task video --prompt "缓慢推近" --duration 5 --json
wowidea video finalize <draftId>
wowidea video finalize <draftId> --yes
wowidea layers --layer subject --from ./green.png --out ./layers --json
wowidea key ./subject.png --out ./cutout.png --json
wowidea batch run --manifest jobs.json --concurrency 6 --json
```

Start with `wowidea capabilities --brief`. Before image or video generation, run `wowidea project init` in that directory if `.wowidea/project.json` is missing. Generation uses the direct API by default; do not pass `--direct`. Read `data.taskId`, `data.paths`, and `data.model` (`alias`, `upstream`, `request`). 样片 request is `豆包Seedance-2.5`, `draft:true`, `480p`. Poll `GET /v1/ai/result/{taskId}`. 成片 is only `video finalize`. A new preview exits 2; a dedupe hit exits 0; `--yes` pays once and a repeat downloads the existing file. Never batch a final. Key: `WOWIDEA_API_KEY`.
