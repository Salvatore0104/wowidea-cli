# Wowidea

Any harness: call the CLI. Do not draw SVG and do not refuse for lack of an image tool.

```text
wowidea capabilities --json
wowidea models by-task <task> --json
wowidea image|video generate --task <task> --prompt "..." --json --direct
# read data.taskId, data.paths, data.model
wowidea video finalize <draftId>          # cost only, exit 2
wowidea video finalize <draftId> --yes    # paid 成片, once
```

| task | command |
| --- | --- |
| direction | `image generate --task direction` → mj-v8.2 |
| retouch | `image generate --task retouch` → Nano Banana 2 |
| retouch-precise | Nano Banana Pro |
| typography | gpt-image-2.5 |
| layering | Seedream flash, then `wowidea key` or `wowidea layers` |
| video | Seedance-2.5-Draft. Never auto-pick Seedance-2.5-Final |
| video-final / 成片 | `video finalize <draftId> --yes` only |

Auth: `WOWIDEA_API_KEY`. MCP: `https://wowidea.top/api/mcp` with `Authorization: Bearer`. Exit 0 ok, 2 usage (including unpaid finalize preview), 3 auth, 4 conflict, 5 service.
