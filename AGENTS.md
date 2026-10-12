# Wowidea

Any harness: call the CLI. Do not draw SVG and do not refuse for lack of an image tool.

Install (macOS/Linux): `curl -fsSL https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.sh | bash` (hidden prompt for `WOWIDEA_API_KEY`). Inline key, which may stay in shell history: `curl -fsSL https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.sh | WOWIDEA_API_KEY=sk-... bash`. Windows: `irm https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.ps1 | iex`. Key page: https://wowidea.top/user/api-key. Re-run upgrades `~/.wowidea-cli`.

```text
wowidea capabilities --brief
wowidea models by-task <task> --json
wowidea image|video generate --task <task> --prompt "..." --json --direct
# read data.taskId, data.paths, data.model.alias, data.model.upstream, data.model.request
wowidea video finalize <draftId>          # new draft: estimate, exit 2
wowidea video finalize <draftId>          # already finalized: exit 0, no charge
wowidea video finalize <draftId> --yes    # pay once; a repeat downloads the existing file
```

| task | command |
| --- | --- |
| direction | `image generate --task direction` → mj-v8.2 |
| retouch | `image generate --task retouch` → Nano Banana 2 |
| retouch-precise | Nano Banana Pro |
| typography | gpt-image-2.5 |
| layering | Seedream flash, then `wowidea key` or `wowidea layers` |
| video | `models by-task video` returns request model `豆包Seedance-2.5` plus `draft:true` and `resolution:480p`. Display name is Seedance 2.5 样片. Never send `Seedance-2.5-Draft` |
| video-final / 成片 | `video finalize <draftId> --yes` only |

`data.model` is `{ alias, upstream, request }`. `data.taskId` is always set; `task_id` may also be present.

Auth: `WOWIDEA_API_KEY`. MCP: `https://wowidea.top/api/mcp` with `Authorization: Bearer $WOWIDEA_API_KEY`.

Exit 0 ok, including a finalize dedupe hit. 2 usage, including an unpaid finalize preview that has not been submitted. 3 auth. 4 conflict. 5 service. 6 approval required. 7 budget.
