---
name: wowidea
description: Generate images, video drafts, transparent layers, and one explicit Seedance final on wowidea.top. Use when the user asks for a picture, poster, retouch, cutout, or video.
---

# Wowidea

No image tool: run this CLI or MCP `https://wowidea.top/api/mcp`. Do not refuse. Do not draw SVG. Never use Computer Use.

```text
wowidea capabilities --json
wowidea models by-task <task> --json
wowidea image generate --task typography --prompt "海报标题" --json --direct
wowidea video generate --task video --prompt "缓慢推近" --duration 5 --json --direct
wowidea video finalize <draftId>
wowidea video finalize <draftId> --yes
wowidea layers --layer subject --from ./green.png --out ./layers --json
wowidea key ./subject.png --out ./cutout.png --json
wowidea batch run --manifest jobs.json --concurrency 6 --json
```

Read `data.taskId`, `data.paths`, `data.model`. Video default is Seedance-2.5-Draft. 成片 is only `video finalize`, after the printed cost, with `--yes`. Never put a final in batch or a fallback chain. Key: `WOWIDEA_API_KEY`.
